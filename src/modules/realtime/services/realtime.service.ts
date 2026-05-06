import type { Response } from "express";

export interface RealtimeEventPayload {
  type: string;
  scopes?: string[];
  data: Record<string, unknown>;
}

interface RealtimeClient {
  id: number;
  scope: string;
  response: Response;
}

class RealtimeService {
  private clients = new Map<number, RealtimeClient>();
  private nextClientId = 1;

  constructor() {
    const timer = setInterval(() => {
      this.broadcast({
        type: "heartbeat",
        scopes: ["all"],
        data: {
          now: new Date().toISOString()
        }
      });
    }, 25000);

    timer.unref();
  }

  subscribe(scope: string, response: Response) {
    const clientId = this.nextClientId++;

    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders?.();

    this.clients.set(clientId, {
      id: clientId,
      scope,
      response
    });

    this.writeEvent(response, {
      type: "connected",
      data: {
        clientId,
        scope,
        connectedAt: new Date().toISOString()
      }
    });

    return () => {
      this.clients.delete(clientId);
      response.end();
    };
  }

  publish(payload: RealtimeEventPayload) {
    this.broadcast(payload);
  }

  private broadcast(payload: RealtimeEventPayload) {
    for (const client of this.clients.values()) {
      if (this.canReceive(client.scope, payload.scopes)) {
        this.writeEvent(client.response, payload);
      }
    }
  }

  private canReceive(scope: string, scopes?: string[]) {
    if (!scopes || !scopes.length) {
      return true;
    }

    return scope === "admin" || scopes.includes("all") || scopes.includes(scope);
  }

  private writeEvent(response: Response, payload: { type: string; data: Record<string, unknown> }) {
    response.write(`event: ${payload.type}\n`);
    response.write(`data: ${JSON.stringify(payload.data)}\n\n`);
  }
}

export const realtimeHub = new RealtimeService();
