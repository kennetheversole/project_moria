import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { gateways, sessions, developers, requests, topups, type RouteRule } from "../db/schema";
import { requireDb } from "../db";
import { calculateFees, getPlatformFeePercent } from "../services/billing";
import { createAlbyService } from "../services/alby";
import { generateSessionKey } from "../middleware/auth";
import {
  createL402Challenge,
  parseL402Header,
  verifyL402Token,
  generateL402Header,
  matchPath,
} from "../services/l402";
import type { Env } from "../types";

const app = new Hono<{ Bindings: Env }>();

// Check if request is from a browser
function isBrowserRequest(acceptHeader: string | undefined): boolean {
  return !!acceptHeader?.includes("text/html");
}

// Find matching route rule for a path
function findMatchingRule(rules: RouteRule[] | null, path: string, defaultPrice: number): { price: number; rule?: RouteRule } {
  if (!rules || rules.length === 0) {
    return { price: defaultPrice };
  }

  for (const rule of rules) {
    if (matchPath(rule.pattern, path)) {
      return { price: rule.price, rule };
    }
  }

  // No match, use default
  return { price: defaultPrice };
}

// Generate beautiful 402 Payment Required HTML page
function generate402Page(
  gatewayName: string,
  price: number,
  _gatewayId: string,
  path: string,
  invoice?: string,
  description?: string,
  sessionKey?: string,
  topupId?: string
): string {
  const invoiceSection = invoice ? `
    <div class="invoice-section">
      <div class="invoice-label">Lightning Invoice</div>
      <div class="qr-container">
        <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(invoice)}" alt="Lightning Invoice QR" class="qr-code">
      </div>
      <div class="invoice-string">${invoice.slice(0, 40)}...</div>
      <div id="payment-status" style="color: #888; font-size: 0.85rem; margin: 10px 0;">Waiting for payment...</div>
      <button onclick="navigator.clipboard.writeText('${invoice}');this.textContent='Copied!'" class="copy-btn">
        Copy Invoice
      </button>
      <a href="lightning:${invoice}" class="pay-btn">
        ⚡ Pay with Wallet
      </a>
      ${sessionKey && topupId ? `<script>
        (function() {
          const sessionKey = '${sessionKey}';
          const topupId = '${topupId}';
          const statusEl = document.getElementById('payment-status');
          let attempts = 0;
          const maxAttempts = 120; // 2 minutes max

          async function checkPayment() {
            try {
              const res = await fetch('/api/sessions/topup/' + topupId, {
                headers: { 'X-Session-Key': sessionKey }
              });
              const data = await res.json();

              if (data.status === 'paid') {
                statusEl.style.color = '#4caf50';
                statusEl.innerHTML = '✓ Payment received! Redirecting...';
                // Reload with session key to proceed with the request
                const url = new URL(window.location.href);
                url.searchParams.set('session_key', sessionKey);
                setTimeout(() => window.location.href = url.toString(), 1500);
                return;
              }
            } catch (e) {
              console.error('Error checking payment:', e);
            }

            attempts++;
            if (attempts < maxAttempts) {
              setTimeout(checkPayment, 1000);
            } else {
              statusEl.textContent = 'Payment check timed out. Refresh to try again.';
            }
          }

          checkPayment();
        })();
      </script>` : ''}
    </div>
  ` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>402 Payment Required - ${gatewayName}</title>
  <script src="https://unpkg.com/nostr-tools@2.10.4/lib/nostr.bundle.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      padding: 20px;
    }
    .container {
      max-width: 480px;
      width: 100%;
    }
    .card {
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 16px;
      padding: 2rem;
      text-align: center;
    }
    .status-code {
      font-size: 4rem;
      font-weight: bold;
      background: linear-gradient(135deg, #f7931a, #ffcd00);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .status-text {
      font-size: 1.2rem;
      color: #888;
      margin-bottom: 1.5rem;
    }
    .gateway-name {
      font-size: 1.5rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
    }
    .gateway-path {
      font-family: monospace;
      font-size: 0.9rem;
      color: #666;
      background: #111;
      padding: 8px 12px;
      border-radius: 6px;
      margin-bottom: 1.5rem;
      word-break: break-all;
    }
    .price-card {
      background: linear-gradient(135deg, #1a1a2e, #16213e);
      border-radius: 12px;
      padding: 1.5rem;
      margin: 1.5rem 0;
    }
    .price {
      font-size: 3rem;
      font-weight: bold;
      color: #f7931a;
    }
    .price-unit {
      font-size: 1.2rem;
      color: #888;
    }
    .price-usd {
      font-size: 0.9rem;
      color: #666;
      margin-top: 0.5rem;
    }
    .description {
      color: #aaa;
      margin-bottom: 1.5rem;
      line-height: 1.5;
    }
    .invoice-section {
      margin-top: 1.5rem;
      padding-top: 1.5rem;
      border-top: 1px solid #333;
    }
    .invoice-label {
      color: #888;
      font-size: 0.9rem;
      margin-bottom: 1rem;
    }
    .qr-container {
      background: #fff;
      padding: 12px;
      border-radius: 12px;
      display: inline-block;
      margin-bottom: 1rem;
    }
    .qr-code {
      display: block;
      width: 180px;
      height: 180px;
    }
    .invoice-string {
      font-family: monospace;
      font-size: 0.8rem;
      color: #666;
      margin-bottom: 1rem;
    }
    .copy-btn {
      background: #333;
      color: #fff;
      border: none;
      padding: 12px 24px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 1rem;
      margin-right: 10px;
      transition: background 0.2s;
    }
    .copy-btn:hover {
      background: #444;
    }
    .pay-btn {
      display: inline-block;
      background: linear-gradient(135deg, #f7931a, #ffcd00);
      color: #000;
      text-decoration: none;
      padding: 12px 24px;
      border-radius: 8px;
      font-weight: bold;
      font-size: 1rem;
      transition: transform 0.2s;
    }
    .pay-btn:hover {
      transform: scale(1.02);
    }
    .divider {
      border-top: 1px solid #333;
      margin: 1.5rem 0;
    }
    .how-to {
      text-align: left;
    }
    .how-to-title {
      color: #888;
      font-size: 0.9rem;
      margin-bottom: 1rem;
    }
    .step {
      display: flex;
      align-items: flex-start;
      margin-bottom: 0.8rem;
    }
    .step-num {
      background: #f7931a;
      color: #000;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 0.75rem;
      margin-right: 12px;
      flex-shrink: 0;
    }
    .step-text {
      color: #ccc;
      font-size: 0.9rem;
      line-height: 1.4;
    }
    code {
      background: #222;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.85rem;
      color: #7c3aed;
    }
    .footer {
      margin-top: 1.5rem;
      color: #444;
      font-size: 0.8rem;
    }
    .footer a {
      color: #666;
    }
    .l402-badge {
      display: inline-block;
      background: #222;
      color: #f7931a;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 0.75rem;
      font-weight: bold;
      margin-bottom: 1rem;
    }
    .or-divider {
      display: flex;
      align-items: center;
      margin: 1.5rem 0;
      color: #666;
    }
    .or-divider::before,
    .or-divider::after {
      content: '';
      flex: 1;
      border-top: 1px solid #333;
    }
    .or-divider span {
      padding: 0 1rem;
      font-size: 0.9rem;
    }
    .session-section {
      text-align: left;
    }
    .session-title {
      color: #888;
      font-size: 0.9rem;
      margin-bottom: 1rem;
      text-align: center;
    }
    .session-input-group {
      display: flex;
      gap: 8px;
      margin-bottom: 1rem;
    }
    .session-input {
      flex: 1;
      background: #111;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 12px;
      color: #fff;
      font-family: monospace;
      font-size: 0.9rem;
    }
    .session-input:focus {
      outline: none;
      border-color: #f7931a;
    }
    .session-input::placeholder {
      color: #555;
    }
    .use-session-btn {
      background: #333;
      color: #fff;
      border: none;
      padding: 12px 20px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 0.9rem;
      white-space: nowrap;
      transition: background 0.2s;
    }
    .use-session-btn:hover {
      background: #444;
    }
    .use-session-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .nostr-login-btn {
      width: 100%;
      background: linear-gradient(135deg, #7c3aed, #a855f7);
      color: #fff;
      border: none;
      padding: 14px 24px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 1rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: transform 0.2s, opacity 0.2s;
    }
    .nostr-login-btn:hover {
      transform: scale(1.02);
    }
    .nostr-login-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .sessions-list {
      margin-top: 1rem;
      display: none;
    }
    .sessions-list.visible {
      display: block;
    }
    .sessions-list-title {
      color: #888;
      font-size: 0.85rem;
      margin-bottom: 0.75rem;
    }
    .session-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #111;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 8px;
      cursor: pointer;
      transition: border-color 0.2s, background 0.2s;
    }
    .session-item:hover {
      border-color: #f7931a;
      background: #1a1a1a;
    }
    .session-item-key {
      font-family: monospace;
      font-size: 0.85rem;
      color: #888;
    }
    .session-item-balance {
      color: #f7931a;
      font-weight: bold;
      font-size: 0.9rem;
    }
    .session-item-balance.low {
      color: #ef4444;
    }
    .error-msg {
      background: #2d1b1b;
      border: 1px solid #5c2828;
      color: #f87171;
      padding: 12px;
      border-radius: 8px;
      margin-top: 1rem;
      font-size: 0.9rem;
      display: none;
    }
    .error-msg.visible {
      display: block;
    }
    .success-msg {
      background: #1b2d1b;
      border: 1px solid #285c28;
      color: #4ade80;
      padding: 12px;
      border-radius: 8px;
      margin-top: 1rem;
      font-size: 0.9rem;
      display: none;
    }
    .success-msg.visible {
      display: block;
    }
    .loading {
      opacity: 0.7;
      pointer-events: none;
    }
    .login-options {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .private-key-toggle-btn {
      width: 100%;
      background: #222;
      color: #aaa;
      border: 1px solid #333;
      padding: 12px 24px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 0.9rem;
      transition: background 0.2s, border-color 0.2s;
    }
    .private-key-toggle-btn:hover {
      background: #2a2a2a;
      border-color: #444;
    }
    .private-key-section {
      display: none;
      flex-direction: row;
      gap: 8px;
      margin-top: 8px;
    }
    .private-key-section.visible {
      display: flex;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="l402-badge">L402 ENABLED</div>
      <div class="status-code">402</div>
      <div class="status-text">Payment Required</div>

      <div class="gateway-name">${gatewayName}</div>
      <div class="gateway-path">${path}</div>

      ${description ? `<div class="description">${description}</div>` : ''}

      <div class="price-card">
        <div class="price">${price}</div>
        <div class="price-unit">satoshi${price !== 1 ? 's' : ''}</div>
        <div class="price-usd">≈ $${(price * 0.0004).toFixed(4)} USD</div>
      </div>

      ${invoiceSection}

      <div class="or-divider"><span>OR</span></div>

      <div class="session-section">
        <div class="session-title">Already have credits?</div>

        <div class="session-input-group">
          <input type="text" id="sessionKeyInput" class="session-input" placeholder="sk_xxxxxxxxxxxxxxxx" />
          <button id="useSessionBtn" class="use-session-btn">Use Key</button>
        </div>

        <div class="login-options">
          <button id="nostrLoginBtn" class="nostr-login-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
            </svg>
            Sign in with Extension
          </button>

          <button id="showPrivateKeyBtn" class="private-key-toggle-btn">
            🔑 Sign in with Private Key
          </button>

          <div id="privateKeySection" class="private-key-section">
            <input type="password" id="privateKeyInput" class="session-input" placeholder="nsec... or hex private key" />
            <button id="privateKeyLoginBtn" class="use-session-btn">Sign In</button>
          </div>
        </div>

        <div id="sessionsList" class="sessions-list">
          <div class="sessions-list-title">Your Sessions</div>
          <div id="sessionsContainer"></div>
        </div>

        <div id="errorMsg" class="error-msg"></div>
        <div id="successMsg" class="success-msg"></div>
      </div>

      <div class="divider"></div>

      <div class="how-to">
        <div class="how-to-title">For Developers & AI Agents</div>
        <div class="step">
          <div class="step-num">1</div>
          <div class="step-text">Use <code>Authorization: L402</code> header with macaroon and preimage after payment</div>
        </div>
        <div class="step">
          <div class="step-num">2</div>
          <div class="step-text">Or create a session at <code>/api/sessions/topup</code> and use <code>X-Session-Key</code></div>
        </div>
      </div>

      <div class="footer">
        Powered by <a href="https://github.com/lightninglabs/L402">L402</a> & Lightning Network ⚡
      </div>
    </div>
  </div>

  <script>
    const currentPath = window.location.pathname;
    const price = ${price};
    const RELAYS = ['wss://relay.damus.io'];
    const APP_ID = 'moria:sessions';

    // State
    let currentPubkey = null;
    let currentPrivateKey = null; // Only set for private key login
    let relayConnections = [];

    function showError(msg) {
      const el = document.getElementById('errorMsg');
      el.textContent = msg;
      el.classList.add('visible');
      setTimeout(() => el.classList.remove('visible'), 5000);
    }

    function showSuccess(msg) {
      const el = document.getElementById('successMsg');
      el.textContent = msg;
      el.classList.add('visible');
    }

    function hideSuccess() {
      document.getElementById('successMsg').classList.remove('visible');
    }

    // Connect to relays
    function connectToRelays() {
      return RELAYS.map(url => {
        try {
          const ws = new WebSocket(url);
          ws.relayUrl = url;
          return new Promise((resolve) => {
            ws.onopen = () => resolve(ws);
            ws.onerror = () => resolve(null);
            setTimeout(() => resolve(null), 3000);
          });
        } catch {
          return Promise.resolve(null);
        }
      });
    }

    // Fetch sessions from relays (NIP-78 kind 30078)
    async function fetchSessionsFromRelays(pubkey) {
      const connections = await Promise.all(connectToRelays());
      const activeRelays = connections.filter(ws => ws !== null);

      if (activeRelays.length === 0) {
        throw new Error('Could not connect to any relays');
      }

      return new Promise((resolve) => {
        let events = [];
        let completed = 0;
        const subId = 'moria-' + Math.random().toString(36).slice(2);

        activeRelays.forEach(ws => {
          const filter = {
            kinds: [30078],
            authors: [pubkey],
            '#d': [APP_ID],
            limit: 1
          };

          ws.send(JSON.stringify(['REQ', subId, filter]));

          ws.onmessage = (msg) => {
            try {
              const data = JSON.parse(msg.data);
              if (data[0] === 'EVENT' && data[1] === subId) {
                events.push(data[2]);
              } else if (data[0] === 'EOSE') {
                completed++;
                ws.send(JSON.stringify(['CLOSE', subId]));
                if (completed >= activeRelays.length) {
                  // Return most recent event
                  events.sort((a, b) => b.created_at - a.created_at);
                  resolve(events[0] || null);
                }
              }
            } catch {}
          };
        });

        // Timeout
        setTimeout(() => resolve(events[0] || null), 5000);
      });
    }

    // Decrypt NIP-04 content (using extension or private key)
    async function decryptContent(encryptedContent, pubkey) {
      if (window.nostr && window.nostr.nip04) {
        // Use extension for decryption
        return await window.nostr.nip04.decrypt(pubkey, encryptedContent);
      } else if (currentPrivateKey && window.NostrTools) {
        // Use private key with nostr-tools
        const { nip04 } = window.NostrTools;
        return await nip04.decrypt(currentPrivateKey, pubkey, encryptedContent);
      }
      throw new Error('No decryption method available');
    }

    // Encrypt content (NIP-04)
    async function encryptContent(content, pubkey) {
      if (window.nostr && window.nostr.nip04) {
        return await window.nostr.nip04.encrypt(pubkey, content);
      } else if (currentPrivateKey && window.NostrTools) {
        const { nip04 } = window.NostrTools;
        return await nip04.encrypt(currentPrivateKey, pubkey, content);
      }
      throw new Error('No encryption method available');
    }

    // Migrate sessions from DB to Nostr relay
    async function migrateSessionsFromDB(pubkey, token) {
      try {
        // Fetch sessions from DB
        const res = await fetch('/api/developers/sessions', {
          headers: { 'Authorization': 'Bearer ' + token }
        });

        if (!res.ok) return [];

        const dbSessions = await res.json();
        if (dbSessions.length === 0) return [];

        // Convert to our format
        return dbSessions.map(s => ({
          key: s.sessionKey,
          name: s.name || null,
          created: new Date(s.createdAt).getTime()
        }));
      } catch (e) {
        console.error('Error fetching DB sessions:', e);
        return [];
      }
    }

    // Load sessions from Nostr relays (with auto-migration from DB)
    async function loadSessionsFromNostr(pubkey, authToken) {
      try {
        document.getElementById('sessionsContainer').innerHTML = '<div style="color:#666;font-size:0.85rem;text-align:center;">Loading from relays...</div>';
        document.getElementById('sessionsList').classList.add('visible');

        // Fetch from both sources in parallel
        const [event, dbSessions] = await Promise.all([
          fetchSessionsFromRelays(pubkey),
          authToken ? migrateSessionsFromDB(pubkey, authToken) : Promise.resolve([])
        ]);

        // Parse relay sessions
        let relaySessions = [];
        if (event) {
          try {
            const decrypted = await decryptContent(event.content, pubkey);
            const data = JSON.parse(decrypted);
            relaySessions = data.sessions || [];
          } catch {
            try {
              const data = JSON.parse(event.content);
              relaySessions = data.sessions || [];
            } catch {}
          }
        }

        // Merge: add DB sessions that aren't already in relay
        let needsMigration = false;
        const existingKeys = new Set(relaySessions.map(s => s.key));

        for (const dbSession of dbSessions) {
          if (!existingKeys.has(dbSession.key)) {
            relaySessions.push(dbSession);
            needsMigration = true;
          }
        }

        // If we have new sessions to migrate, publish to relay
        if (needsMigration && relaySessions.length > 0) {
          showSuccess('Migrating ' + dbSessions.length + ' session(s) to Nostr...');

          const content = JSON.stringify({ sessions: relaySessions });
          const encryptedContent = await encryptContent(content, pubkey);
          await publishSessionsEvent(encryptedContent);

          hideSuccess();
          showSuccess('Sessions migrated to Nostr!');
        }

        // Re-fetch from relay after potential migration
        const finalEvent = needsMigration ? await fetchSessionsFromRelays(pubkey) : event;

        if (!finalEvent) {
          document.getElementById('sessionsContainer').innerHTML = \`
            <div style="color:#666;font-size:0.85rem;text-align:center;margin-bottom:10px;">No sessions found on relays.</div>
            <div id="addSessionSection">
              <input type="text" id="newSessionKey" class="session-input" placeholder="Enter session key to save (sk_...)" style="margin-bottom:8px;" />
              <input type="text" id="newSessionName" class="session-input" placeholder="Session name (optional)" style="margin-bottom:8px;" />
              <button id="saveSessionBtn" class="use-session-btn" style="width:100%;">Save to Nostr</button>
            </div>
          \`;
          setupSaveSessionButton();
          return;
        }

        // Decrypt content (encrypted to self)
        let sessionsData;
        try {
          const decrypted = await decryptContent(finalEvent.content, pubkey);
          sessionsData = JSON.parse(decrypted);
        } catch (e) {
          // Try parsing as unencrypted JSON (legacy)
          try {
            sessionsData = JSON.parse(finalEvent.content);
          } catch {
            throw new Error('Could not decrypt sessions data');
          }
        }

        const sessions = sessionsData.sessions || [];

        if (sessions.length > 0) {
          // Fetch balances for each session
          const sessionsWithBalances = await Promise.all(
            sessions.map(async (s) => {
              try {
                const res = await fetch('/api/sessions/me', {
                  headers: { 'X-Session-Key': s.key }
                });
                if (res.ok) {
                  const data = await res.json();
                  return { ...s, balanceSats: data.balanceSats };
                }
              } catch {}
              return { ...s, balanceSats: null };
            })
          );

          renderSessions(sessionsWithBalances);
        } else {
          document.getElementById('sessionsContainer').innerHTML = \`
            <div style="color:#666;font-size:0.85rem;text-align:center;margin-bottom:10px;">No sessions saved yet.</div>
            <div id="addSessionSection">
              <input type="text" id="newSessionKey" class="session-input" placeholder="Enter session key to save (sk_...)" style="margin-bottom:8px;" />
              <input type="text" id="newSessionName" class="session-input" placeholder="Session name (optional)" style="margin-bottom:8px;" />
              <button id="saveSessionBtn" class="use-session-btn" style="width:100%;">Save to Nostr</button>
            </div>
          \`;
          setupSaveSessionButton();
        }
      } catch (e) {
        console.error('Error loading sessions:', e);
        document.getElementById('sessionsContainer').innerHTML = '<div style="color:#f87171;font-size:0.85rem;text-align:center;">Error: ' + e.message + '</div>';
      }
    }

    function renderSessions(sessions) {
      const container = document.getElementById('sessionsContainer');
      container.innerHTML = '';

      sessions.forEach(session => {
        const div = document.createElement('div');
        div.className = 'session-item';
        const balanceText = session.balanceSats !== null ? session.balanceSats + ' sats' : '...';
        const isLow = session.balanceSats !== null && session.balanceSats < price;
        div.innerHTML = \`
          <span class="session-item-key">\${session.name || session.key.slice(0, 12) + '...'}</span>
          <span class="session-item-balance \${isLow ? 'low' : ''}">\${balanceText}</span>
        \`;
        div.addEventListener('click', () => useSessionKey(session.key));
        container.appendChild(div);
      });

      // Add "add session" section
      const addDiv = document.createElement('div');
      addDiv.id = 'addSessionSection';
      addDiv.style.marginTop = '12px';
      addDiv.style.paddingTop = '12px';
      addDiv.style.borderTop = '1px solid #333';
      addDiv.innerHTML = \`
        <input type="text" id="newSessionKey" class="session-input" placeholder="Add session key (sk_...)" style="margin-bottom:8px;" />
        <input type="text" id="newSessionName" class="session-input" placeholder="Session name (optional)" style="margin-bottom:8px;" />
        <button id="saveSessionBtn" class="use-session-btn" style="width:100%;">Save to Nostr</button>
      \`;
      container.appendChild(addDiv);
      setupSaveSessionButton();

      document.getElementById('sessionsList').classList.add('visible');
    }

    function setupSaveSessionButton() {
      const btn = document.getElementById('saveSessionBtn');
      if (btn) {
        btn.addEventListener('click', saveNewSession);
      }
    }

    async function saveNewSession() {
      const keyInput = document.getElementById('newSessionKey');
      const nameInput = document.getElementById('newSessionName');
      const key = keyInput.value.trim();
      const name = nameInput.value.trim();

      if (!key || !key.startsWith('sk_')) {
        showError('Invalid session key format');
        return;
      }

      // Verify session exists
      try {
        const res = await fetch('/api/sessions/me', {
          headers: { 'X-Session-Key': key }
        });
        if (!res.ok) {
          showError('Session key not found');
          return;
        }
      } catch {
        showError('Could not verify session');
        return;
      }

      showSuccess('Saving to Nostr relays...');

      try {
        // Fetch existing sessions
        const existingEvent = await fetchSessionsFromRelays(currentPubkey);
        let sessions = [];

        if (existingEvent) {
          try {
            const decrypted = await decryptContent(existingEvent.content, currentPubkey);
            const data = JSON.parse(decrypted);
            sessions = data.sessions || [];
          } catch {
            try {
              const data = JSON.parse(existingEvent.content);
              sessions = data.sessions || [];
            } catch {}
          }
        }

        // Add new session if not duplicate
        if (!sessions.find(s => s.key === key)) {
          sessions.push({ key, name: name || null, created: Date.now() });
        }

        // Encrypt and publish
        const content = JSON.stringify({ sessions });
        const encryptedContent = await encryptContent(content, currentPubkey);

        await publishSessionsEvent(encryptedContent);

        hideSuccess();
        showSuccess('Saved to Nostr!');
        keyInput.value = '';
        nameInput.value = '';

        // Reload
        await loadSessionsFromNostr(currentPubkey);
      } catch (e) {
        showError('Failed to save: ' + e.message);
      }
    }

    async function publishSessionsEvent(encryptedContent) {
      const eventTemplate = {
        kind: 30078,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['d', APP_ID]],
        content: encryptedContent
      };

      let signedEvent;
      if (window.nostr) {
        signedEvent = await window.nostr.signEvent(eventTemplate);
      } else if (currentPrivateKey && window.NostrTools) {
        const { finalizeEvent } = window.NostrTools;
        signedEvent = finalizeEvent(eventTemplate, currentPrivateKey);
      } else {
        throw new Error('No signing method available');
      }

      // Publish to relays
      const connections = await Promise.all(connectToRelays());
      const activeRelays = connections.filter(ws => ws !== null);

      if (activeRelays.length === 0) {
        throw new Error('Could not connect to any relays');
      }

      activeRelays.forEach(ws => {
        ws.send(JSON.stringify(['EVENT', signedEvent]));
      });

      // Wait a bit for propagation
      await new Promise(r => setTimeout(r, 1000));
    }

    async function useSessionKey(sessionKey) {
      if (!sessionKey || !sessionKey.startsWith('sk_')) {
        showError('Invalid session key format. Should start with sk_');
        return;
      }

      try {
        const res = await fetch('/api/sessions/me', {
          headers: { 'X-Session-Key': sessionKey }
        });

        if (!res.ok) {
          showError('Invalid session key');
          return;
        }

        const session = await res.json();

        if (session.balanceSats < price) {
          showError('Insufficient balance: ' + session.balanceSats + ' sats (need ' + price + ')');
          return;
        }

        const url = new URL(window.location.href);
        url.searchParams.set('session_key', sessionKey);
        window.location.href = url.toString();
      } catch (e) {
        showError('Error: ' + e.message);
      }
    }

    // Use session key button
    document.getElementById('useSessionBtn').addEventListener('click', () => {
      const key = document.getElementById('sessionKeyInput').value.trim();
      useSessionKey(key);
    });

    document.getElementById('sessionKeyInput').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        const key = document.getElementById('sessionKeyInput').value.trim();
        useSessionKey(key);
      }
    });

    // Nostr extension login
    document.getElementById('nostrLoginBtn').addEventListener('click', async () => {
      const btn = document.getElementById('nostrLoginBtn');

      if (!window.nostr) {
        showError('No Nostr extension found. Please install Alby, nos2x, or similar.');
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Signing in...';

      try {
        currentPubkey = await window.nostr.getPublicKey();
        currentPrivateKey = null; // Using extension

        // Get auth token for DB migration
        let authToken = null;
        try {
          const authEvent = {
            kind: 22242,
            created_at: Math.floor(Date.now() / 1000),
            tags: [['challenge', 'moria-402-' + Date.now()]],
            content: 'Authenticate to Moria Gateway',
            pubkey: currentPubkey
          };
          const signedAuthEvent = await window.nostr.signEvent(authEvent);

          const authRes = await fetch('/api/developers/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ signedEvent: signedAuthEvent })
          });

          if (authRes.ok) {
            const auth = await authRes.json();
            authToken = auth.token;
          }
        } catch (e) {
          console.log('Could not get auth token, skipping DB migration');
        }

        showSuccess('Loading sessions from Nostr relays...');
        await loadSessionsFromNostr(currentPubkey, authToken);

        btn.textContent = 'Signed in ✓';
      } catch (e) {
        showError('Login failed: ' + e.message);
        btn.disabled = false;
        btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg> Sign in with Extension';
      }
    });

    // Toggle private key section
    document.getElementById('showPrivateKeyBtn').addEventListener('click', () => {
      document.getElementById('privateKeySection').classList.toggle('visible');
    });

    // Private key login
    document.getElementById('privateKeyLoginBtn').addEventListener('click', async () => {
      const privateKeyInput = document.getElementById('privateKeyInput').value.trim();
      if (!privateKeyInput) {
        showError('Please enter your private key');
        return;
      }

      const btn = document.getElementById('privateKeyLoginBtn');
      btn.disabled = true;
      btn.textContent = 'Signing in...';

      try {
        if (!window.NostrTools) {
          throw new Error('Nostr tools not loaded. Please refresh.');
        }

        const { nip19, getPublicKey, finalizeEvent } = window.NostrTools;

        let privateKeyHex = privateKeyInput;

        if (privateKeyInput.startsWith('nsec')) {
          const decoded = nip19.decode(privateKeyInput);
          if (decoded.type !== 'nsec') {
            throw new Error('Invalid nsec format');
          }
          privateKeyHex = Array.from(decoded.data).map(b => b.toString(16).padStart(2, '0')).join('');
        }

        if (!/^[0-9a-fA-F]{64}$/.test(privateKeyHex)) {
          throw new Error('Invalid private key format');
        }

        currentPrivateKey = new Uint8Array(privateKeyHex.match(/.{2}/g).map(b => parseInt(b, 16)));
        currentPubkey = getPublicKey(currentPrivateKey);

        // Clear input immediately for security
        document.getElementById('privateKeyInput').value = '';

        // Get auth token for DB migration
        let authToken = null;
        try {
          const authEventTemplate = {
            kind: 22242,
            created_at: Math.floor(Date.now() / 1000),
            tags: [['challenge', 'moria-402-' + Date.now()]],
            content: 'Authenticate to Moria Gateway'
          };
          const signedAuthEvent = finalizeEvent(authEventTemplate, currentPrivateKey);

          const authRes = await fetch('/api/developers/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ signedEvent: signedAuthEvent })
          });

          if (authRes.ok) {
            const auth = await authRes.json();
            authToken = auth.token;
          }
        } catch (e) {
          console.log('Could not get auth token, skipping DB migration');
        }

        showSuccess('Loading sessions from Nostr relays...');
        await loadSessionsFromNostr(currentPubkey, authToken);

        btn.textContent = 'Signed in ✓';
      } catch (e) {
        showError('Login failed: ' + e.message);
        btn.disabled = false;
        btn.textContent = 'Sign In';
        currentPrivateKey = null;
        currentPubkey = null;
      }
    });
  </script>
</body>
</html>`;
}

// Proxy all requests to /g/:gatewayId/*
app.all("/:gatewayId/*", async (c) => {
  const db = requireDb(c.env.DB, c.env.DATABASE_URL, c.env.HYPERDRIVE);
  const gatewayId = c.req.param("gatewayId");
  const acceptHeader = c.req.header("Accept");
  const isBrowser = isBrowserRequest(acceptHeader);
  const pathAfterGateway = c.req.path.replace(`/g/${gatewayId}`, "") || "/";

  // Look up gateway first (needed for all paths)
  const gateway = await db
    .select()
    .from(gateways)
    .where(eq(gateways.id, gatewayId))
    .limit(1);

  if (gateway.length === 0) {
    return c.json(
      { success: false, error: "Gateway not found", code: "GATEWAY_NOT_FOUND" },
      404
    );
  }

  if (!gateway[0].isActive) {
    return c.json(
      { success: false, error: "Gateway is not active", code: "GATEWAY_INACTIVE" },
      503
    );
  }

  // Parse route rules and find matching price
  let rules: RouteRule[] | null = null;
  try {
    rules = gateway[0].rules ? JSON.parse(gateway[0].rules) : null;
  } catch {
    rules = null;
  }

  const { price: costSats, rule: matchedRule } = findMatchingRule(
    rules,
    pathAfterGateway,
    gateway[0].pricePerRequestSats
  );

  // Check for L402 Authorization header first
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("L402 ")) {
    const token = parseL402Header(authHeader);
    if (token) {
      const jwtSecret = c.env.JWT_SECRET || "default-secret";
      const verification = await verifyL402Token(token, gatewayId, pathAfterGateway, jwtSecret);

      if (verification.valid) {
        // L402 token valid - process request without charging (already paid)
        return await forwardRequest(c, gateway[0], pathAfterGateway, null, costSats);
      }
    }
  }

  // Check for session key
  const sessionKey = c.req.header("X-Session-Key") || c.req.query("session_key");

  // If price is 0, allow through without auth
  if (costSats === 0) {
    return await forwardRequest(c, gateway[0], pathAfterGateway, null, 0);
  }

  if (!sessionKey) {
    const alby = createAlbyService(c.env.ALBY_API_KEY);
    const db = requireDb(c.env.DB, c.env.DATABASE_URL, c.env.HYPERDRIVE);

    if (isBrowser) {
      // For browsers: create a session + topup so payment credits the session
      let invoice = null;
      let newSessionKey = null;
      let topupId = null;

      try {
        // Create a new session
        const sessionId = nanoid();
        newSessionKey = generateSessionKey();

        await db.insert(sessions).values({
          id: sessionId,
          sessionKey: newSessionKey,
        });

        // Create topup with invoice
        const inv = await alby.createInvoice(costSats, `Moria: ${gateway[0].name} - ${pathAfterGateway}`);
        topupId = nanoid();

        await db.insert(topups).values({
          id: topupId,
          sessionId,
          amountSats: costSats,
          paymentHash: inv.payment_hash,
          status: "pending",
        });

        invoice = inv.payment_request;
      } catch (e) {
        console.error("Failed to create session/invoice:", e);
      }

      const response = new Response(
        generate402Page(
          gateway[0].name,
          costSats,
          gatewayId,
          pathAfterGateway,
          invoice || undefined,
          matchedRule?.description || gateway[0].description || undefined,
          newSessionKey || undefined,
          topupId || undefined
        ),
        {
          status: 402,
          headers: { "Content-Type": "text/html" },
        }
      );

      return response;
    }

    // For API clients: use L402
    let l402Challenge = null;

    try {
      const inv = await alby.createInvoice(costSats, `L402: ${gateway[0].name} - ${pathAfterGateway}`);
      const jwtSecret = c.env.JWT_SECRET || "default-secret";
      l402Challenge = await createL402Challenge(
        inv.payment_hash,
        inv.payment_request,
        gatewayId,
        pathAfterGateway,
        costSats,
        jwtSecret
      );
    } catch (e) {
      console.error("Failed to create invoice:", e);
    }

    // JSON response for API clients
    const responseData: Record<string, unknown> = {
      success: false,
      error: "Payment required",
      code: "PAYMENT_REQUIRED",
      price: costSats,
      gateway: gateway[0].name,
      path: pathAfterGateway,
    };

    if (l402Challenge) {
      responseData.l402 = {
        macaroon: l402Challenge.macaroon,
        invoice: l402Challenge.invoice,
        paymentHash: l402Challenge.paymentHash,
      };
    }

    const response = c.json(responseData, 402);

    if (l402Challenge) {
      c.header("WWW-Authenticate", generateL402Header(l402Challenge));
    }

    return response;
  }

  // Look up session
  const session = await db
    .select()
    .from(sessions)
    .where(eq(sessions.sessionKey, sessionKey))
    .limit(1);

  if (session.length === 0) {
    return c.json(
      { success: false, error: "Invalid session key", code: "INVALID_SESSION_KEY" },
      401
    );
  }

  // Check balance
  if (session[0].balanceSats < costSats) {
    const alby = createAlbyService(c.env.ALBY_API_KEY);

    if (isBrowser) {
      // For browsers: create a topup for the existing session
      let invoice = null;
      let topupId = null;

      try {
        const inv = await alby.createInvoice(costSats, `Moria topup: ${gateway[0].name} - ${pathAfterGateway}`);
        topupId = nanoid();

        await db.insert(topups).values({
          id: topupId,
          sessionId: session[0].id,
          amountSats: costSats,
          paymentHash: inv.payment_hash,
          status: "pending",
        });

        invoice = inv.payment_request;
      } catch (e) {
        console.error("Failed to create topup invoice:", e);
      }

      const response = new Response(
        generate402Page(
          gateway[0].name,
          costSats,
          gatewayId,
          pathAfterGateway,
          invoice || undefined,
          matchedRule?.description || gateway[0].description || undefined,
          sessionKey,
          topupId || undefined
        ),
        {
          status: 402,
          headers: { "Content-Type": "text/html" },
        }
      );

      return response;
    }

    // For API clients: use L402
    let l402Challenge = null;

    try {
      const inv = await alby.createInvoice(costSats, `L402: ${gateway[0].name} - ${pathAfterGateway}`);
      const jwtSecret = c.env.JWT_SECRET || "default-secret";
      l402Challenge = await createL402Challenge(
        inv.payment_hash,
        inv.payment_request,
        gatewayId,
        pathAfterGateway,
        costSats,
        jwtSecret
      );
    } catch (e) {
      console.error("Failed to create invoice:", e);
    }

    const responseData: Record<string, unknown> = {
      success: false,
      error: "Insufficient balance. Please top up.",
      code: "INSUFFICIENT_BALANCE",
      balanceSats: session[0].balanceSats,
      requiredSats: costSats,
    };

    if (l402Challenge) {
      responseData.l402 = {
        macaroon: l402Challenge.macaroon,
        invoice: l402Challenge.invoice,
        paymentHash: l402Challenge.paymentHash,
      };
    }

    return c.json(responseData, 402);
  }

  // Process request with session payment
  return await forwardRequest(c, gateway[0], pathAfterGateway, session[0], costSats);
});

// Forward request to target API
async function forwardRequest(
  c: any,
  gateway: any,
  path: string,
  session: any | null,
  costSats: number
) {
  const db = requireDb(c.env.DB, c.env.DATABASE_URL, c.env.HYPERDRIVE);

  // Build the target URL
  const targetUrl = new URL(path || "/", gateway.targetUrl);

  // Copy query parameters
  const originalUrl = new URL(c.req.url);
  originalUrl.searchParams.forEach((value: string, key: string) => {
    if (key !== "session_key") {
      targetUrl.searchParams.set(key, value);
    }
  });

  // Prepare headers
  const headersToExclude = new Set([
    "host", "connection", "keep-alive", "transfer-encoding",
    "te", "trailer", "upgrade", "x-session-key", "authorization",
  ]);

  const forwardHeaders = new Headers();
  c.req.raw.headers.forEach((value: string, key: string) => {
    if (!headersToExclude.has(key.toLowerCase())) {
      forwardHeaders.set(key, value);
    }
  });

  // Forward the request
  let response: Response;
  let statusCode: number;

  try {
    response = await fetch(targetUrl.toString(), {
      method: c.req.method,
      headers: forwardHeaders,
      body: c.req.method !== "GET" && c.req.method !== "HEAD"
        ? await c.req.raw.clone().arrayBuffer()
        : undefined,
    });
    statusCode = response.status;
  } catch (error) {
    console.error("Proxy error:", error);
    return c.json(
      { success: false, error: "Failed to reach target API", code: "PROXY_ERROR" },
      502
    );
  }

  // Only charge if we have a session and cost > 0
  if (session && costSats > 0) {
    const feePercent = getPlatformFeePercent(c.env.PLATFORM_FEE_PERCENT);
    const fees = calculateFees(costSats, feePercent);

    // Deduct from session balance
    await db
      .update(sessions)
      .set({
        balanceSats: session.balanceSats - costSats,
        updatedAt: new Date(),
      })
      .where(eq(sessions.id, session.id));

    // Credit developer
    const developer = await db
      .select()
      .from(developers)
      .where(eq(developers.id, gateway.developerId))
      .limit(1);

    if (developer.length > 0) {
      await db
        .update(developers)
        .set({
          balanceSats: developer[0].balanceSats + fees.devEarnings,
          updatedAt: new Date(),
        })
        .where(eq(developers.id, developer[0].id));
    }

    // Log request
    await db.insert(requests).values({
      id: nanoid(),
      gatewayId: gateway.id,
      sessionId: session.id,
      costSats: fees.totalCost,
      devEarningsSats: fees.devEarnings,
      platformFeeSats: fees.platformFee,
      method: c.req.method,
      path: path || "/",
      statusCode,
    });
  }

  // Build response with headers
  const responseHeaders = new Headers(response.headers);
  if (session) {
    responseHeaders.set("X-Balance-Remaining", String(session.balanceSats - costSats));
  }
  responseHeaders.set("X-Request-Cost", String(costSats));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

export default app;
