/* ==========================================================================
   server/errors.js — typed application errors

   Every error carries a stable machine-readable `code` and an HTTP `status`.
   Route handlers convert them with toHttp() so provider internals, stack
   traces and secrets never reach the client.
   ========================================================================== */
'use strict';

class AppError extends Error {
  /**
   * @param {string} code stable machine code (snake_case)
   * @param {string} [message] human message (only exposed when status < 500)
   * @param {number} [status] HTTP status
   * @param {object} [details] safe, non-secret extra fields
   */
  constructor(code, message, status = 500, details) {
    super(message || code);
    this.name = this.constructor.name;
    this.code = code;
    this.status = status;
    /** @type {boolean} whether the message may be shown to the client */
    this.expose = status < 500;
    if (details !== undefined) this.details = details;
  }
}

class ConfigError extends AppError { constructor(message, details) { super('invalid_configuration', message, 500, details); } }
class ValidationError extends AppError { constructor(message, details) { super('invalid_request', message || 'Invalid request.', 400, details); } }
class AuthError extends AppError { constructor(message) { super('auth_required', message || 'Authentication required.', 401); } }
class ForbiddenError extends AppError { constructor(message) { super('forbidden', message || 'Not permitted.', 403); } }
class NotFoundError extends AppError { constructor(message) { super('not_found', message || 'Not found.', 404); } }
class MethodNotAllowedError extends AppError { constructor(message) { super('method_not_allowed', message || 'Method not allowed.', 405); } }
class ConflictError extends AppError { constructor(message, details) { super('conflict', message || 'Conflict.', 409, details); } }
class ApprovalRequiredError extends AppError { constructor(message, details) { super('approval_required', message || 'This action needs explicit confirmation.', 409, details); } }
class PayloadTooLargeError extends AppError { constructor(message) { super('payload_too_large', message || 'Request body too large.', 413); } }
class RateLimitError extends AppError { constructor(message, details) { super('rate_limited', message || 'Too many requests.', 429, details); } }
class ProviderError extends AppError { constructor(message, details) { super('provider_error', message || 'Model provider failed.', 502, details); } }
class TimeoutError extends AppError { constructor(message) { super('timeout', message || 'The operation timed out.', 504); } }
class ToolError extends AppError { constructor(message, details) { super('tool_error', message || 'Tool failed.', 500, details); } }
class ToolDeniedError extends AppError { constructor(message, details) { super('tool_denied', message || 'Tool not permitted.', 403, details); } }
class AgentOfflineError extends AppError { constructor(message, details) { super('agent_offline', message || 'The local agent is not connected.', 503, details); } }
class AgentBusyError extends AppError { constructor(message, details) { super('agent_busy', message || 'The local agent is busy.', 409, details); } }
class AgentProtocolError extends AppError { constructor(message, details) { super('agent_protocol_error', message || 'Invalid agent message.', 400, details); } }

/**
 * Convert any thrown value into a safe HTTP response descriptor.
 * Unknown errors are logged by the caller and returned as a generic 500.
 * @param {unknown} err
 * @returns {{ status: number, body: object, expose: boolean }}
 */
function toHttp(err) {
  if (err instanceof AppError) {
    const body = { ok: false, error: err.code };
    if (err.expose && err.message) body.message = err.message;
    if (err.details && typeof err.details === 'object') {
      for (const k of Object.keys(err.details)) {
        if (!/(key|token|secret|password|authorization)/i.test(k)) body[k] = err.details[k];
      }
    }
    return { status: err.status, body, expose: true };
  }
  return { status: 500, body: { ok: false, error: 'internal_error', message: 'Internal error.' }, expose: false };
}

module.exports = {
  AppError, ConfigError, ValidationError, AuthError, ForbiddenError, NotFoundError,
  MethodNotAllowedError, ConflictError, ApprovalRequiredError, PayloadTooLargeError,
  RateLimitError, ProviderError, TimeoutError, ToolError, ToolDeniedError,
  AgentOfflineError, AgentBusyError, AgentProtocolError, toHttp
};
