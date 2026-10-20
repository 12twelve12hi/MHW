// Error answers (DESIGN.md 10.4) and the response helpers every route uses.

import { errorMessage } from '../client/daylight-server.js';

export interface ErrorExtra {
  feature?: string;
  missing?: string[];
  retryAfter?: number;
  limit?: number;
  tokens?: number;
  estimateUsd?: number;
  resetAt?: string;
  missingParts?: number[];
  ceilingUsd?: number;
  message?: string;
}

export class ServerError extends Error {
  status: number;
  code: string;
  extra: ErrorExtra;
  constructor(status: number, code: string, extra: ErrorExtra = {}) {
    super(code);
    this.name = 'ServerError';
    this.status = status;
    this.code = code;
    this.extra = extra;
  }

  body() {
    const { ceilingUsd, message, ...rest } = this.extra;
    return { error: { code: this.code, message: message ?? errorMessage(this.code, this.extra), ...rest } };
  }
}

export const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-DLS-Source-Name',
  'Access-Control-Expose-Headers': 'Retry-After, Content-Length, X-DLS-Request-Id',
  'Access-Control-Max-Age': '86400',
};

export function baseHeaders(rid: string, extra: Record<string, string> = {}): Headers {
  const h = new Headers({ ...CORS, 'Cache-Control': 'no-store', 'X-DLS-Request-Id': rid, ...extra });
  return h;
}

export function json(rid: string, status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status, headers: baseHeaders(rid, { 'Content-Type': 'application/json; charset=utf-8', ...extra }),
  });
}

export function empty(rid: string, status: number): Response {
  return new Response(null, { status, headers: baseHeaders(rid) });
}

export function errorResponse(rid: string, e: ServerError): Response {
  const extra: Record<string, string> = {};
  if (e.extra.retryAfter && e.status !== 200) extra['Retry-After'] = String(e.extra.retryAfter);
  return json(rid, e.status, e.body(), extra);
}

/** 400 BAD_REQUEST naming the field that is wrong (never its value). */
export const bad = (field?: string) => new ServerError(400, 'BAD_REQUEST', field ? { message: `That request isn’t valid (${field}).` } : {});
export const notFound = () => new ServerError(404, 'NOT_FOUND');
