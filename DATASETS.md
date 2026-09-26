# Recommendation data shortlist

Research checked 26 September 2026. The app currently uses 14 short editorial reference cards and versioned recommendation rules. **The datasets below have not been imported or used to train the app.** More records do not establish field-level accuracy.

| Resource | Size / coverage verified | Useful role | Limits before use |
| --- | --- | --- | --- |
| [ISRIC WoSIS](https://isric.org/explore/wosis) | Over 230,000 profiles, 174 countries, over 6 million soil records as of mid-2025 | Soil measurement context, method-aware comparisons, data-quality checks | Observations are not fertilizer prescriptions. Verify Pakistan coverage, depth, date, method and per-record licensing. Do not present nearby profiles as the user's soil. |
| [CIMMYT / CSISA nutrient omission trials](https://hdl.handle.net/11529/10911) | Trials in 28 districts across Bihar, Uttar Pradesh and Odisha; rice and wheat; 2012–2015 trial period | A closer regional candidate for studying nutrient response | Indian trials are not Pakistan calibration. Repository lists custom dataset terms; review those terms and the wheat codebook before import. Row count has not been verified. |
| [East Africa wheat nutrient response data](https://doi.org/10.5061/dryad.3692hh9) | 18 site-years in Kenya, Rwanda and Tanzania; downloadable 389.35 KB workbook | Wheat-specific benchmark for testing nutrient-response analysis | Different soils and climate. Useful for evaluating methods, not transferring treatment rates to Punjab. Verify the dataset license and workbook fields before reuse. |
| [OFRA crop nutrient response functions](https://doi.org/10.5061/dryad.tt6h5h1) | Tropical Africa; August 2023 workbook is 5.04 MB | Broader research comparison across crops and nutrient responses | Mixed crops and response functions, not a locally validated wheat recommendation table. Filter by crop, conditions and provenance; check terms. |

## Practical choice

Prioritize licensed local wheat soil-test calibration tables and agronomist-approved decision rules. CSISA trials are a promising research candidate because of their South Asian context; WoSIS is useful supporting measurement data. Neither should directly set an application rate for this user.

An ingestible recommendation record should contain: rule ID and version, crop, region, growth stage, irrigated/rainfed system, soil parameter, analytical method, sampling depth, unit, applicable range, action, contraindications, source URL, publication date, reuse terms and reviewer. Unknown prerequisites should produce a request for evidence, not a guessed action.

Before enabling prescriptions: check reuse terms; inspect original data and codebooks; normalize units without conflating test methods; retain missing values; validate rules with a local agronomist; evaluate against held-out local field cases. Track incorrect actions, unsupported rates and appropriate abstentions, not just text similarity.

## What changed now

- OpenAI extracts visible observations and report text. Disease hypotheses do not drive the recommendation rules.
- Fixed rules select three evidence-gathering next steps; these are not experimentally validated treatment prescriptions.
- Lab ratings are shown only when explicitly recognizable. Numeric nutrient measurements do not imply low/high status.
- The pH chart plots the reported number on a 0–14 scale. It does not add a universal wheat target or infer a lime dose.
- FAO, ISRIC and Punjab source cards expand the former five-card library to 14. This is a reference expansion, not ingestion of millions of dataset records.

Sources: [WoSIS data policy and methods](https://docs.isric.org/globaldata/wosis/faq-wosis.html), [FAO wheat field guide](https://www.fao.org/4/x8234e/x8234e08.htm), [FAO dryland wheat management](https://www.fao.org/4/Y4011E/y4011e0s.htm), [Punjab soil salinity research and advisory services](https://agripunjab.gov.pk/ssri-achievements).
