export const sampleContext = { crop: 'Wheat', stage: 'Stem elongation', location: 'Sample field · Punjab', notes: 'Illustrative scenario: scattered orange-brown spots on several leaves. No rainfall or soil-moisture measurements supplied.' };
export const sampleVision = {
  usable: true, crop: 'Wheat (sample scenario)', summary: 'Scattered orange-brown markings and some yellowing are visible.',
  observations: ['Illustrative orange-brown markings on the upper leaf surface.', 'Some surrounding yellowing in this fictional example.'],
  possibleIssues: [],
  limitations: ['Sample findings are predefined, not an analysis of your photo.', 'A photograph alone cannot confirm the pathogen.'],
  followUp: ['Photograph both leaf surfaces in daylight.', 'Check multiple plants and record how widely symptoms occur.']
};
export const sampleSoil = {
  readable: true, summary: 'Illustrative soil values — editable before planning.',
  readings: [
    { parameter: 'pH', value: '7.6', unit: 'pH', reference: 'Not supplied', interpretation: 'No crop-specific laboratory rating supplied' },
    { parameter: 'Nitrogen', value: 'Low', unit: 'Lab category', reference: 'Sample report rating', interpretation: 'Low, as stated in the fictional report' },
    { parameter: 'Phosphorus', value: 'Medium', unit: 'Lab category', reference: 'Sample report rating', interpretation: 'Medium, as stated in the fictional report' },
    { parameter: 'Potassium', value: 'Adequate', unit: 'Lab category', reference: 'Sample report rating', interpretation: 'Adequate, as stated in the fictional report' }
  ], warnings: ['Fictional report for demonstrating the workflow. No fertilizer rate can be calculated from these categories.']
};
export function samplePlan(soil, sources) {
  const ids = new Set(sources.map(s => s.id));
  const actions = [
    { title: 'Inspect the affected leaves', priority: 'Now', detail: 'Compare both surfaces of several leaves and record the distribution of pustules. Share clear images with a local crop adviser.', rationale: 'The sample symptoms resemble leaf rust, but field confirmation is still needed.', sourceIds: ['WHEAT-01'] },
    { title: 'Review the soil report with your adviser', priority: 'Next', detail: `Review the ${soil.length} confirmed soil entries, including their units, laboratory methods and reference ranges, before selecting nutrient inputs.`, rationale: 'Laboratory context is needed to interpret soil measurements.', sourceIds: ['SOIL-01'] },
    { title: 'Measure moisture before scheduling irrigation', priority: 'Monitor', detail: 'Record root-zone soil moisture, recent rain and crop growth stage before deciding when to irrigate.', rationale: 'The sample has no measured water balance or soil moisture.', sourceIds: ['WATER-01'] }
  ].filter(a => a.sourceIds.every(id => ids.has(id)));
  return { summary: 'Sample action plan: confirm the leaf symptoms and fill the evidence gaps before choosing treatment.', actions, irrigation: 'Not determined. Supply root-zone moisture, soil texture, recent rainfall and crop water-use information.', nutrition: 'No application rate calculated. The confirmed soil entries require local laboratory and crop-specific interpretation.', missingInformation: ['Confirmed disease identity', 'Soil test method and sampling depth', 'Root-zone moisture and rainfall history'], limitations: ['Predefined sample walkthrough; no AI inference was performed.', 'The reference library contains general US extension guidance, not locally validated application rates.'] };
}
