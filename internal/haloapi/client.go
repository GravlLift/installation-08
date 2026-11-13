// Package haloapi provides the Halo Infinite endpoints needed to fetch a film.
package haloapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strings"
	"sync"
	"time"
)

type Endpoints struct{ Stats, Discovery, Economy string }

var DefaultEndpoints = Endpoints{"https://halostats.svc.halowaypoint.com:443/hi", "https://discovery-infiniteugc.svc.halowaypoint.com/hi", "https://economy.svc.halowaypoint.com/hi"}

type Client struct {
	http               *http.Client
	endpoints          Endpoints
	spartan, clearance string
	mu                 sync.Mutex
	next               time.Time
	interval           time.Duration
}

func New(h *http.Client, e Endpoints, spartan, clearance string) *Client {
	if h == nil {
		h = &http.Client{Timeout: 30 * time.Second}
	}
	clone := *h
	clone.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= 10 {
			return errors.New("too many redirects")
		}
		req.Header.Del("x-343-authorization-spartan")
		req.Header.Del("343-clearance")
		return nil
	}
	return &Client{http: &clone, endpoints: e, spartan: spartan, clearance: clearance, interval: 200 * time.Millisecond}
}

type FilmUnavailableError struct{}

func (*FilmUnavailableError) Error() string { return "film is not available" }

type httpError struct{ status int }

func (e *httpError) Error() string { return fmt.Sprintf("Halo service returned HTTP %d", e.status) }
func (c *Client) wait(ctx context.Context) error {
	c.mu.Lock()
	now := time.Now()
	at := c.next
	if at.Before(now) {
		at = now
	}
	c.next = at.Add(c.interval)
	c.mu.Unlock()
	timer := time.NewTimer(time.Until(at))
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
func (c *Client) get(ctx context.Context, endpoint string, auth bool) ([]byte, error) {
	u, err := url.Parse(endpoint)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || u.User != nil {
		return nil, errors.New("invalid service URL")
	}
	for attempt := 0; attempt < 3; attempt++ {
		if err := c.wait(ctx); err != nil {
			return nil, err
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			return nil, errors.New("invalid service request")
		}
		req.Header.Set("Accept", "application/json")
		if auth {
			req.Header.Set("x-343-authorization-spartan", c.spartan)
			req.Header.Set("343-clearance", c.clearance)
		}
		resp, err := c.http.Do(req)
		if err == nil {
			body, readErr := io.ReadAll(io.LimitReader(resp.Body, 64<<20+1))
			resp.Body.Close()
			if readErr != nil {
				return nil, errors.New("service response read failed")
			}
			if len(body) > 64<<20 {
				return nil, errors.New("service response too large")
			}
			if resp.StatusCode >= 200 && resp.StatusCode < 300 {
				return body, nil
			}
			if resp.StatusCode != 429 && resp.StatusCode < 500 {
				return nil, &httpError{resp.StatusCode}
			}
			err = &httpError{resp.StatusCode}
		}
		if attempt == 2 {
			if e, ok := err.(*httpError); ok {
				return nil, e
			}
			return nil, errors.New("service request failed")
		}
		timer := time.NewTimer(time.Duration(1<<attempt) * 250 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
	return nil, errors.New("service request failed")
}
func (c *Client) json(ctx context.Context, endpoint string, out any) ([]byte, error) {
	b, err := c.get(ctx, endpoint, true)
	if err != nil {
		return nil, err
	}
	if json.Unmarshal(b, out) != nil {
		return nil, errors.New("invalid service response")
	}
	return b, nil
}
func segment(s string) string { return url.PathEscape(s) }
func blobURL(prefix, rel string) string {
	return strings.TrimRight(prefix, "/") + "/" + strings.TrimLeft(rel, "/")
}

type Match struct {
	ID   string `json:"MatchId"`
	Info struct {
		Start string `json:"StartTime"`
		Map   any    `json:"MapVariant"`
		Mode  any    `json:"UgcGameVariant"`
	} `json:"MatchInfo"`
}

func (c *Client) Matches(ctx context.Context, xuid string, count int) ([]Match, error) {
	if count < 1 || count > 25 {
		return nil, errors.New("count must be between 1 and 25")
	}
	var result struct {
		Results []Match `json:"Results"`
	}
	_, err := c.json(ctx, fmt.Sprintf("%s/players/xuid(%s)/matches?count=%d&start=0&type=all", c.endpoints.Stats, segment(xuid), count), &result)
	return result.Results, err
}
func (c *Client) Stats(ctx context.Context, id string) ([]byte, error) {
	var v any
	return c.json(ctx, c.endpoints.Stats+"/matches/"+segment(id)+"/stats", &v)
}

type Chunk struct {
	Index    int    `json:"Index"`
	Type     int    `json:"ChunkType"`
	Size     int    `json:"ChunkSize"`
	Start    int    `json:"ChunkStartTimeOffsetMilliseconds"`
	Duration int    `json:"DurationMilliseconds"`
	Path     string `json:"FileRelativePath"`
}
type Manifest struct {
	Prefix string `json:"BlobStoragePathPrefix"`
	Custom struct {
		Chunks []Chunk `json:"Chunks"`
	} `json:"CustomData"`
}

func (c *Client) Manifest(ctx context.Context, id string) (Manifest, []byte, error) {
	var m Manifest
	b, err := c.json(ctx, c.endpoints.Discovery+"/films/matches/"+segment(id)+"/spectate", &m)
	var status *httpError
	if errors.As(err, &status) && (status.status == 404 || status.status == 410) {
		err = &FilmUnavailableError{}
	}
	return m, b, err
}
func (c *Client) Chunk(ctx context.Context, prefix string, ch Chunk) ([]byte, error) {
	b, err := c.get(ctx, blobURL(prefix, ch.Path), false)
	var status *httpError
	if errors.As(err, &status) && (status.status == 404 || status.status == 410) {
		return nil, &FilmUnavailableError{}
	}
	if err == nil && ch.Size > 0 && len(b) != ch.Size {
		return nil, errors.New("incomplete film chunk")
	}
	return b, err
}
func (c *Client) Customization(ctx context.Context, xuid string) ([]byte, error) {
	var v any
	return c.json(ctx, c.endpoints.Economy+"/players/xuid("+segment(xuid)+")/customization?view=public", &v)
}
func (c *Client) Mvar(ctx context.Context, id string) ([]byte, error) {
	var a struct {
		Files struct {
			Prefix string   `json:"Prefix"`
			Paths  []string `json:"FileRelativePaths"`
		} `json:"Files"`
	}
	_, err := c.json(ctx, c.endpoints.Discovery+"/Maps/"+segment(id), &a)
	if err != nil {
		return nil, err
	}
	selected := ""
	for _, p := range a.Files.Paths {
		if strings.HasSuffix(strings.ToLower(p), ".mvar") {
			if selected == "" {
				selected = p
			}
			if strings.EqualFold(path.Base(p), "map.mvar") {
				selected = p
				break
			}
		}
	}
	if selected == "" || a.Files.Prefix == "" {
		return nil, errors.New("map variant unavailable")
	}
	return c.get(ctx, blobURL(a.Files.Prefix, selected), false)
}
