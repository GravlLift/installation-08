// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package haloauth

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type Endpoints struct{ Device, Token, User, XSTS, Spartan, Clearance string }

var DefaultEndpoints = Endpoints{
	"https://login.microsoftonline.com/consumers/oauth2/v2.0/DeviceCode",
	"https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
	"https://user.auth.xboxlive.com/user/authenticate",
	"https://xsts.auth.xboxlive.com/xsts/authorize",
	"https://settings.svc.halowaypoint.com/spartan-token",
	"https://settings.svc.halowaypoint.com/oban/flight-configurations/titles/hi/audiences/RETAIL/active",
}

type Credentials struct {
	ClientID  string    `json:"client_id"`
	Refresh   string    `json:"refresh"`
	Spartan   string    `json:"spartan"`
	Clearance string    `json:"clearance"`
	Gamertag  string    `json:"gamertag"`
	XUID      string    `json:"xuid"`
	Expires   time.Time `json:"expires"`
}
type Client struct {
	dir       string
	http      *http.Client
	endpoints Endpoints
	mu        sync.Mutex
	tokens    Credentials
}

func New(dir string, client *http.Client, endpoints Endpoints) *Client {
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second}
	}
	copyClient := *client
	copyClient.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &Client{dir: dir, http: &copyClient, endpoints: endpoints}
}

type deviceResponse struct {
	Device   string `json:"device_code"`
	Code     string `json:"user_code"`
	URI      string `json:"verification_uri"`
	Expires  int    `json:"expires_in"`
	Interval int    `json:"interval"`
}
type OAuthToken struct {
	Access  string `json:"access_token"`
	Refresh string `json:"refresh_token"`
	Error   string `json:"error"`
}

// DeviceCode is the half of the device-code flow that does not wait for the user: the
// address and short code to show, and the wait bounded by the code's own lifetime.
type DeviceCode struct {
	Wait     context.Context
	cancel   context.CancelFunc
	Device   string
	URI      string
	Code     string
	Expires  time.Duration
	Interval time.Duration
}

// StartLogin asks Microsoft for a device code and returns it with the user-facing address
// and short code. It does not wait for the user to enter the code. A terminal client shows
// the pair and keeps waiting in Login; a server starts it in the background and answers the
// web viewer with the pair, then waits in its own loop. Cancelling the returned wait (or
// its parent) ends any wait built on it early.
func (c *Client) StartLogin(ctx context.Context, id string) (*DeviceCode, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if strings.TrimSpace(id) == "" {
		return nil, errors.New("client id is required")
	}
	var d deviceResponse
	_, err := c.form(ctx, c.endpoints.Device, url.Values{"client_id": {id}, "scope": {"Xboxlive.signin Xboxlive.offline_access"}}, &d)
	if err != nil {
		return nil, err
	}
	if d.Device == "" || d.Code == "" || d.URI == "" || d.Expires <= 0 {
		return nil, errors.New("invalid device authorization response")
	}
	wait, cancel := context.WithTimeout(ctx, time.Duration(d.Expires)*time.Second)
	if d.Interval <= 0 {
		d.Interval = 5
	}
	return &DeviceCode{Wait: wait, cancel: cancel, Device: d.Device, URI: d.URI, Code: d.Code, Expires: time.Duration(d.Expires) * time.Second, Interval: time.Duration(d.Interval) * time.Second}, nil
}

func (c *Client) Login(ctx context.Context, id string, show func(string, string)) (Credentials, error) {
	d, err := c.StartLogin(ctx, id)
	if err != nil {
		return Credentials{}, err
	}
	defer d.cancel()
	show(d.URI, d.Code)
	interval := d.Interval
	for {
		if interval > 0 {
			select {
			case <-d.Wait.Done():
				return Credentials{}, errors.New("device authorization expired or canceled")
			case <-time.After(interval):
			}
		}
		token, adjust, err := c.pollDeviceToken(d, id)
		if err != nil {
			return Credentials{}, err
		}
		if token == nil {
			interval += adjust
			continue
		}
		return c.finishLogin(d.Wait, id, *token)
	}
}

// Poll asks the token endpoint once for the device code f. A nil token means the user has
// not finished yet; adjust is a non-zero interval lengthening when the endpoint asked to
// slow down. A caller that polls on its own schedule (a server holding the login session)
// uses this instead of the built-in loop.
func (c *Client) Poll(d *DeviceCode, id string) (*OAuthToken, time.Duration, error) {
	return c.pollDeviceToken(d, id)
}

// CompleteLogin exchanges a token Poll returned for the full credentials and persists
// them. It takes the wait StartLogin returned so the exchange dies with the code's own
// lifetime.
func (c *Client) CompleteLogin(ctx context.Context, id string, token *OAuthToken) (Credentials, error) {
	if token == nil {
		return Credentials{}, errors.New("device authorization is not complete yet")
	}
	return c.finishLogin(ctx, id, *token)
}

// pollDeviceToken asks the token endpoint once. A nil token means the user has not
// finished yet; adjust is a non-zero interval lengthening when the endpoint asked to slow
// down.
func (c *Client) pollDeviceToken(d *DeviceCode, id string) (*OAuthToken, time.Duration, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	var token OAuthToken
	_, err := c.form(d.Wait, c.endpoints.Token, url.Values{"client_id": {id}, "grant_type": {"urn:ietf:params:oauth:grant-type:device_code"}, "device_code": {d.Device}}, &token)
	if err != nil {
		return nil, 0, err
	}
	switch token.Error {
	case "authorization_pending":
		return nil, 0, nil
	case "slow_down":
		return nil, 5 * time.Second, nil
	case "":
	default:
		return nil, 0, errors.New("device authorization failed")
	}
	if token.Access == "" || token.Refresh == "" {
		return nil, 0, errors.New("invalid Microsoft token response")
	}
	return &token, 0, nil
}

func (c *Client) finishLogin(ctx context.Context, id string, token OAuthToken) (Credentials, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	result, err := c.exchange(ctx, token.Access)
	if err != nil {
		return Credentials{}, err
	}
	result.ClientID = id
	result.Refresh = token.Refresh
	if err = c.persist(result); err != nil {
		return Credentials{}, err
	}
	return result, nil
}

func (c *Client) Current(ctx context.Context) (Credentials, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.tokens.Refresh == "" {
		raw, err := Load(c.dir)
		if err != nil {
			return Credentials{}, err
		}
		if json.Unmarshal(raw, &c.tokens) != nil {
			return Credentials{}, errors.New("invalid stored credentials")
		}
	}
	if c.tokens.Spartan != "" && time.Until(c.tokens.Expires) > time.Minute {
		return c.tokens, nil
	}
	if c.tokens.ClientID == "" || c.tokens.Refresh == "" {
		return Credentials{}, errors.New("stored credentials are incomplete; sign in again")
	}
	var token OAuthToken
	_, err := c.form(ctx, c.endpoints.Token, url.Values{"client_id": {c.tokens.ClientID}, "grant_type": {"refresh_token"}, "refresh_token": {c.tokens.Refresh}, "scope": {"Xboxlive.signin Xboxlive.offline_access"}}, &token)
	if err != nil {
		return Credentials{}, err
	}
	if token.Error != "" || token.Access == "" {
		return Credentials{}, errors.New("Microsoft refresh failed; sign in again")
	}
	result, err := c.exchange(ctx, token.Access)
	if err != nil {
		return Credentials{}, err
	}
	result.ClientID = c.tokens.ClientID
	result.Refresh = token.Refresh
	if result.Refresh == "" {
		result.Refresh = c.tokens.Refresh
	}
	if err = c.persist(result); err != nil {
		return Credentials{}, err
	}
	return result, nil
}
func (c *Client) persist(v Credentials) error {
	b, err := json.Marshal(v)
	if err != nil {
		return errors.New("encode credentials")
	}
	if err = Save(c.dir, b); err != nil {
		return err
	}
	c.tokens = v
	return nil
}
func (c *Client) Logout() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	err := os.Remove(filepath.Join(c.dir, "auth", "tokens.dat"))
	if errors.Is(err, os.ErrNotExist) {
		err = nil
	}
	if err == nil {
		c.tokens = Credentials{}
	}
	return err
}

func (c *Client) form(ctx context.Context, endpoint string, values url.Values, out any) (int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(values.Encode()))
	if err != nil {
		return 0, errors.New("invalid authentication endpoint")
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	return c.do(req, out, true)
}
func (c *Client) json(ctx context.Context, endpoint string, payload any, out any) (int, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return 0, errors.New("invalid authentication request")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(data))
	if err != nil {
		return 0, errors.New("invalid authentication endpoint")
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-xbl-contract-version", "1")
	return c.do(req, out, false)
}
func (c *Client) do(req *http.Request, out any, allowError bool) (int, error) {
	resp, err := c.http.Do(req)
	if err != nil {
		return 0, errors.New("authentication request failed")
	}
	defer resp.Body.Close()
	if !allowError && (resp.StatusCode < 200 || resp.StatusCode >= 300) {
		return resp.StatusCode, fmt.Errorf("authentication service returned HTTP %d", resp.StatusCode)
	}
	if err = json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(out); err != nil {
		return resp.StatusCode, errors.New("invalid authentication response")
	}
	return resp.StatusCode, nil
}
