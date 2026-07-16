import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTool } from '../src/toolSchema.js';

const tool = { id: 'issue-api', name: 'Issue API', type: 'http', config: { url: 'https://api.example.com/issues/{{id}}', method: 'GET', allowedHosts: ['api.example.com'], headers: { authorization: '$env.ISSUE_TOKEN' } }, secretEnv: ['ISSUE_TOKEN'], inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } }, outputSchema: { type: 'object', properties: {} } };
test('accepts an allowlisted HTTPS tool with declared secrets', () => assert.equal(validateTool(tool).status, 'draft'));
test('rejects HTTP, IP literals, and undeclared secrets', () => assert.throws(() => validateTool({ ...tool, config: { ...tool.config, url: 'http://127.0.0.1/x', allowedHosts: ['127.0.0.1'], headers: { authorization: '$env.OTHER' } } }), /invalid/));
test('rejects literal credentials in sensitive headers', () => assert.throws(() => validateTool({ ...tool, config: { ...tool.config, headers: { authorization: 'Bearer secret' } } }), /invalid/));
