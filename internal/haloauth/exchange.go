// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package haloauth

import (
	"context"
	"errors"
	"net/http"
	"time"
)

type xboxResponse struct {
	Token   string `json:"Token"`
	Display struct {
		XUI []struct {
			Gamertag string `json:"gtg"`
			XUID     string `json:"xid"`
		} `json:"xui"`
	} `json:"DisplayClaims"`
}

func (c *Client) exchange(ctx context.Context, access string) (Credentials, error) {
	var user xboxResponse
	for _, prefix := range []string{"d=", "t="} {
		status, err := c.json(ctx, c.endpoints.User, map[string]any{"RelyingParty": "http://auth.xboxlive.com", "TokenType": "JWT", "Properties": map[string]string{"AuthMethod": "RPS", "SiteName": "user.auth.xboxlive.com", "RpsTicket": prefix + access}}, &user)
		if err == nil {
			break
		}
		if status != http.StatusUnauthorized || prefix == "t=" {
			return Credentials{}, err
		}
	}
	if user.Token == "" {
		return Credentials{}, errors.New("missing Xbox user token")
	}
	var xsts xboxResponse
	_, err := c.json(ctx, c.endpoints.XSTS, map[string]any{"RelyingParty": "https://prod.xsts.halowaypoint.com/", "TokenType": "JWT", "Properties": map[string]any{"SandboxId": "RETAIL", "UserTokens": []string{user.Token}}}, &xsts)
	if err != nil {
		return Credentials{}, err
	}
	if xsts.Token == "" {
		return Credentials{}, errors.New("missing Xbox identity")
	}
	identity := xsts
	if len(identity.Display.XUI) == 0 || identity.Display.XUI[0].Gamertag == "" || identity.Display.XUI[0].XUID == "" {
		_, err = c.json(ctx, c.endpoints.XSTS, map[string]any{"RelyingParty": "http://xboxlive.com", "TokenType": "JWT", "Properties": map[string]any{"SandboxId": "RETAIL", "UserTokens": []string{user.Token}}}, &identity)
		if err != nil {
			return Credentials{}, err
		}
	}
	if len(identity.Display.XUI) == 0 || identity.Display.XUI[0].Gamertag == "" || identity.Display.XUI[0].XUID == "" {
		return Credentials{}, errors.New("missing Xbox identity")
	}
	var sp struct {
		Token   string `json:"SpartanToken"`
		Expires struct {
			ISO string `json:"ISO8601Date"`
		} `json:"ExpiresUtc"`
	}
	_, err = c.json(ctx, c.endpoints.Spartan, map[string]any{"Audience": "urn:343:s3:services", "MinVersion": "4", "Proof": []map[string]string{{"Token": xsts.Token, "TokenType": "Xbox_XSTSv3"}}}, &sp)
	if err != nil {
		return Credentials{}, err
	}
	if sp.Token == "" {
		return Credentials{}, errors.New("missing Spartan token")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.endpoints.Clearance, nil)
	if err != nil {
		return Credentials{}, errors.New("invalid clearance endpoint")
	}
	req.Header.Set("x-343-authorization-spartan", sp.Token)
	var clearance struct {
		ID string `json:"FlightConfigurationId"`
	}
	_, err = c.do(req, &clearance, false)
	if err != nil {
		return Credentials{}, err
	}
	if clearance.ID == "" {
		return Credentials{}, errors.New("missing clearance token")
	}
	expiry, _ := time.Parse(time.RFC3339, sp.Expires.ISO)
	return Credentials{Spartan: sp.Token, Clearance: clearance.ID, Gamertag: identity.Display.XUI[0].Gamertag, XUID: identity.Display.XUI[0].XUID, Expires: expiry}, nil
}
