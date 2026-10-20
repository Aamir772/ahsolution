'use strict';
/* ==========================================================================
   server/workflows/index.js — workflow registry + engine + builtin definitions
   ========================================================================= */
const registry = require('./registry');
const { createWorkflowEngine, RUN_STATES, canonical, interpolate, boundResult } = require('./engine');
const { registerBuiltins, buildWorkflows } = require('./workflows');

module.exports = {
  register: registry.register,
  get: registry.get,
  list: registry.list,
  resolveSteps: registry.resolveSteps,
  applyInputs: registry.applyInputs,
  availability: registry.availability,
  assertAvailable: registry.assertAvailable,
  createWorkflowEngine,
  RUN_STATES,
  canonical,
  interpolate,
  boundResult,
  registerBuiltins,
  buildWorkflows
};
