# Boreal Living — fictional test retailer

The user explicitly authorised a fictitious retailer, SKUs, inventory and illustrative use-case images for customer acceptance testing. Nothing in this directory represents an actual company, product, order or customer.

`catalogue.json` contains seven fictional products across bed, wardrobe, bedside, desk and rug categories. All dimensions/prices/stock are explicit synthetic test inputs. The three studio product PNGs and staged bedroom PNG were generated for this test scenario; they do not establish measurements, brand affiliation or physical product availability. Product images may be shared between fictional finish/size examples as illustration; not every product has a photograph.

Use only the guarded `npm run seed:test-customer` local workflow. It creates an isolated labelled test organisation, generated persona accounts, a measured consultation, mapped simulated feed, private reference and explicitly published offers. It never seeds an arbitrary existing retailer. Generated credentials, upstream state and real record IDs belong under ignored `.local/fixtures`, never here. Browser fixtures use their own ignored `.local/e2e-fixtures`.

See [the walkthrough](../../docs/TEST_CUSTOMER.md) and [deployment limits](../../docs/DEPLOYMENT.md).

`models/*.glb` are self-contained, simple illustrative furniture models at the catalogue dimensions, floor-centred with no fit scaling. `photo-demo/` is a labelled synthetic room rendered from a known pinhole camera: `calibration.json` contains its ground truth, `analysis.json` is a recorded chest selection, and `empty.png` is its known empty reference. The fixture adapter checks the exact source image and fictional tenant; it cannot analyse unrelated photographs. These are mathematical/interaction acceptance assets, not a claim of photorealism or live OpenAI capability. Rebuild them with `node scripts/build-photo-fixtures.mjs`; the original generated bedroom/product photographs are not edited by that script.
