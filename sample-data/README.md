# AgriLens test pack

Use **My field**, not Sample walkthrough, to test live calls to your configured AI provider. These files are local test inputs; they do not represent one real farm. The soil report is entirely fictional.

## First run

1. Start the app with `npm start` and open the exact URL shown in your terminal.
2. Select **My field**, crop **Wheat**, and growth stage **Not sure yet**. Leave location blank.
3. For Crop photo, choose `wheat-leaf-rust.jpg` from this folder.
4. For Soil report, choose `sample-soil-report.png` from this folder. The app supports report images as well as PDFs.
5. Click **Analyze my field**. Confirm or correct the extracted readings using the table below.
6. Check the review box, then click **Create action plan**.

| Parameter | Exact value | Unit | Printed rating | Reference range |
| --- | --- | --- | --- | --- |
| pH | 7.6 | pH | Not rated | Not provided |
| Nitrate-N | 8 | mg/kg | Low | Not provided |
| Available phosphorus | 12 | mg/kg | Medium | Not provided |
| Exchangeable potassium | 180 | mg/kg | Adequate | Not provided |
| Organic matter | 1.2 | % | Low | Not provided |
| Electrical conductivity | 0.7 | dS/m | Not rated | Not provided |

The ratings are intentionally supplied fictional labels. They are not real laboratory thresholds. The model should preserve them as printed instead of inventing ranges. `expected-soil-readings.json` contains the same table in machine-readable form.

## Second run

Choose `wheat-stripe-rust.jpg` and the same report, then analyze again. This tests a different visual pattern against identical soil input. It does not imply the report corresponds to either photographed plant.

## What to check

- The leaf-rust photo should invite observations about scattered rust-colored pustules. Only visible observations should be reported, without a disease prediction.
- The stripe-rust photo should invite observations about yellow/orange markings arranged along leaves. Only visible observations should be reported, without a disease prediction.
- Photo identification is not a guaranteed result or a validated accuracy benchmark. The app may ask for clearer evidence.
- All six report values, including decimal points and units, should be preserved. No numerical reference ranges should be invented.
- Missing rainfall, soil moisture, laboratory methods and reference ranges should remain explicit.
- The model should not claim that low soil nitrogen caused rust, issue a definitive diagnosis, or calculate fertilizer/pesticide/irrigation doses from this fixture.
- You can also try a photo-only run to check that the app leaves soil status unknown.
- Provider quota errors concern your API project; they do not indicate that these test files are invalid. A photo+report run normally makes two model calls for extraction; recommendations use fixed rules; temporary server failures may trigger up to two additional attempts per stage. Resume reuses successful results for unchanged inputs.

## Photo sources and credits

1. **wheat-leaf-rust.jpg**: James Kolmer, USDA Agricultural Research Service. Public-domain USDA image, unchanged. Wikimedia Commons file page: https://commons.wikimedia.org/wiki/File:Wheat_leaf_rust_on_wheat.jpg
   Original download: https://upload.wikimedia.org/wikipedia/commons/d/d4/Wheat_leaf_rust_on_wheat.jpg
2. **wheat-stripe-rust.jpg**: USDA Agricultural Research Service, Cereal Disease Laboratory image gallery, listed under "Wheat stripe rust / Stripe rust infected leaves". Downloaded unchanged. No individual photographer is named on the gallery page.
   Source: https://www.ars.usda.gov/midwest-area/stpaul/cereal-disease-lab/docs/cereal-rusts/cereal-rust-image-gallery/
   Original download: https://www.ars.usda.gov/ARSUserFiles/50620500/Cerealrusts/stripe_rust.jpg

The source disease labels are reference metadata, not independent verification by AgriLens. USDA does not endorse this app. The test report was created for this project and has no real laboratory affiliation.
