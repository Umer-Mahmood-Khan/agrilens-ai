import test from 'node:test';
import assert from 'node:assert/strict';
import { labRating, phValue } from '../public/soil.mjs';
import { recommend } from '../lib/recommendations.mjs';
import { sampleVision, sampleSoil, sampleContext } from '../lib/sample.mjs';

const row = (interpretation, value = '8.5') => ({ parameter: 'Phosphorus', value, unit: 'mg/kg', reference: '', interpretation });
test('visual ratings use explicit lab categories and reject unknown, negated or ambiguous text', () => {
  for (const text of ['', 'Not low', 'No rating', 'Low to medium', 'Low, but adequate for this crop', '8.5', 'Below 10']) assert.equal(labRating(row(text)), 'Unrated');
  assert.equal(labRating(row('Low')), 'Low');
  assert.equal(labRating(row('Adequate')), 'Adequate');
  assert.equal(labRating(sampleSoil.readings[1]), 'Low');
  assert.equal(labRating(row('', 'Low')), 'Unrated');
});
test('pH plot accepts exact pH values without converting other measurements or guessing ranges', () => {
  const ph = { ...row(''), parameter: 'pH', value: '7.6' };
  assert.equal(phValue(ph), 7.6);
  for (const value of ['7-8', '<7', '', 'NaN', '15', '-1', '7.6 ppm']) assert.equal(phValue({ ...ph, value }), null);
  assert.equal(phValue(row('')), null);
  assert.equal(phValue({ ...ph, parameter: 'Phosphorus' }), null);
});
test('missing evidence and lab corrections change recommendations without diagnosing disease', () => {
  const analysis = { mode: 'live', context: sampleContext, vision: sampleVision };
  const numericOnly = recommend(analysis, [row('')]);
  assert.equal(numericOnly.actions[1].title, 'Confirm the lab interpretation');
  const low = recommend(analysis, [row('Low')]);
  assert.match(low.actions[1].detail, /Phosphorus/);
  assert.equal(recommend(analysis, []).actions[1].title, 'Get a soil test');
  assert.equal(recommend({ ...analysis, vision: { ...sampleVision, usable: false } }, []).actions[0].title, 'Retake the crop photo');
  assert.deepEqual(recommend({ ...analysis, vision: { ...sampleVision, possibleIssues: [{ name: 'invented disease', evidence: 'unsupported' }] } }, [row('')]), numericOnly);
  assert.equal(recommend(analysis, [row('Adequate')]).actions[1].title, 'Confirm the lab interpretation');
});
