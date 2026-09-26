import { labRating } from '../public/soil.mjs';

// Versioned editorial rules, not a trained predictor or a fertilizer calculator.
export const ruleVersion = 'wheat-evidence-v1';
export function recommend(analysis, readings) {
  const low = readings.filter(r => /^(nitrogen|nitrate(?:-n)?|phosphorus|potassium|zinc|boron|sulfur|sulphur|magnesium|iron|manganese|copper)(?:\s|$)/i.test(r.parameter) && labRating(r) === 'Low');
  const actions = [{
    title: analysis.vision.usable ? 'Check the field before treatment' : 'Retake the crop photo', priority: 'Now',
    detail: analysis.vision.usable ? 'Inspect several plants. Photograph both leaf surfaces and share the pattern with a local crop adviser.' : 'Take sharp daylight photos of both leaf surfaces and the whole plant.',
    rationale: analysis.vision.usable ? 'A single photo cannot establish the cause or extent of damage.' : 'The uploaded image did not provide usable crop evidence.', sourceIds: ['FIELD-01']
  }, {
    title: !readings.length ? 'Get a soil test' : low.length ? 'Review the reported low nutrients' : 'Confirm the lab interpretation', priority: 'Next',
    detail: !readings.length ? 'Use a local laboratory to measure the soil before choosing nutrient inputs.' : low.length ? `Ask your local adviser to review ${low.map(r => r.parameter).join(', ')} with the test method and crop stage before choosing inputs.` : 'Check the sampling depth, test method and crop-specific rating with your laboratory.',
    rationale: low.length ? `The confirmed report labels ${low.length} nutrient ${low.length === 1 ? 'entry' : 'entries'} low. No rate has been calculated.` : 'Measurements need laboratory context before they support an application decision.', sourceIds: ['SOIL-01', 'FAO-01']
  }, {
    title: 'Check water before irrigating', priority: 'Monitor',
    detail: 'Record root-zone moisture, recent rain and irrigation. Use those records to decide the next watering with your adviser.',
    rationale: 'This workflow does not calculate a measured daily water balance.', sourceIds: ['WATER-01']
  }];
  return {
    summary: 'Verify the crop. Review the soil. Check the water.', actions,
    irrigation: 'Scheduling needs measured moisture and a daily water balance.',
    nutrition: 'Application rates need a locally calibrated soil-test recommendation.',
    missingInformation: [...(!analysis.context.location ? ['Field location'] : []), ...(analysis.context.stage === 'Unknown' ? ['Growth stage'] : []), 'Laboratory method and sampling depth', 'Moisture and rainfall records'],
    limitations: [
      'These are evidence-gathering recommendations, not a diagnosis or treatment prescription.',
      'Rules are editorial and have not been field-validated. International guidance does not establish local application rates.',
      ...(analysis.mode === 'sample' ? ['Illustrative sample; no AI inference was performed.'] : ['Photo observations and report extraction use AI; confirm them against your field and report.'])
    ]
  };
}
