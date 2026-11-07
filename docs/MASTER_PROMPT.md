> **Note (later owner decisions).** This is the original brief, kept unchanged. Since it was written the **Kids range and guardian-managed child profiles were removed** (ModVerse is Men's and Women's only; stored kids data is converted/hidden, never deleted), and the **Men's and Women's avatars are the supplied FBX characters** (with a procedural fallback). See `docs/BUILD_STATUS.md`.

MODVERSE

FINAL MASTER PRODUCT, DESIGN, ENGINEERING AND IMPLEMENTATION SPECIFICATION

Brand: ModVerse
Tagline: YOUR WORLD. YOUR STYLE.
Product: AI-powered personalised fashion design and commerce platform
Initial market: India
Initial garment focus: Men’s, Women’s and Kids’ T-shirts and shirts
Development approach: Local-first, API-ready, modular, extensible
Primary objective: Build a genuinely functional fashion-tech platform, not a static ecommerce prototype.

> Repository note: this file is the verbatim master specification supplied by the
> project owner. The supplied logo arrived as a PNG (`modverse-logo-original.png`,
> 1774×887) and is stored unmodified at `public/brand/modverse-logo-original.png`.
> `ModVerse_Library_Catalog.pdf` was not supplied; the library was integrated from
> the actual ZIP archive and its JSON/CSV manifests.

⸻

PART 1 — YOUR ROLE AND THE MISSION

Act as the principal software architect, full-stack engineer, AI engineer, computer-vision engineer, 3D graphics engineer, fashion technology engineer, UX/UI designer, database architect and technical project lead for ModVerse.

Your responsibility is to build ModVerse as a unified, premium, AI-powered custom-fashion platform.

Do not interpret this project as a conventional T-shirt printing website.

ModVerse must enable customers to design and customise the garment itself, including its silhouette, construction, proportions, fabric, colours, individual panels, graphics, typography, embroidery, finishing and other supported details.

The platform must combine:

* Fashion ecommerce.
* Interactive garment design.
* Advanced garment customisation.
* AI-assisted creative design.
* Natural-language design instructions.
* Custom typography.
* 2D artwork editing.
* Interactive 3D garment visualisation.
* Digital avatars.
* Measurement-based sizing.
* Live-camera virtual try-on.
* Fashion asset library.
* Manufacturing-aware design validation.
* Technical documentation.
* Customer and admin accounts.
* Order management.
* Future manufacturing and fulfilment integrations.

Build all major product areas as one connected system.

Do not artificially postpone advanced design features or make them unavailable to users during the first local testing release.

The first local release must include the Design Studio, Atelier and Atelier Pro experiences, with the maximum feasible working functionality in each.

Do not promise that every advanced fashion-engineering capability can be production-grade immediately. Implement what is technically feasible, identify prototypes honestly, and build extensible architecture for the remaining professional capabilities.

⸻

PART 2 — OFFICIAL BRAND IDENTITY AND LOGO

The supplied ModVerse logo is the official brand identity.

The logo contains:

* A distinctive stylised M monogram.
* The ModVerse wordmark.
* The tagline: YOUR WORLD. YOUR STYLE.
* A black background with elegant white lettering.

Use the actual supplied logo file.

Source file:
20C4B77C-D689-44D5-A149-A4275BF7464D(1).jpeg

The original file is supplied with the project assets. Copy it into the project, for example:

public/brand/modverse-logo-original.jpeg

Do not redraw, replace, distort, crop incorrectly or invent another logo.

Preserve the proportions and original appearance.

If transparent or alternative logo variants are needed, create derived variants carefully while preserving the original master file.

2.1 Brand direction

The brand should feel:

* Premium.
* Modern.
* Fashion-forward.
* Minimalist.
* Sophisticated.
* Creative.
* Technologically advanced.
* International.
* Distinctive.

Use the supplied monochromatic identity as the foundation.

Recommended interface direction:

* Black and off-black surfaces.
* White and warm-white typography.
* Carefully selected neutral grey tones.
* Restrained metallic or muted accent colours where appropriate.
* Premium typography.
* Generous whitespace.
* High-quality garment imagery.
* Clear visual hierarchy.
* Subtle transitions and animations.

Avoid excessive gradients, generic SaaS dashboard styling, visual clutter and unnecessary decoration.

2.2 Logo placement

Use the logo appropriately in:

* Landing page.
* Header and navigation.
* Login and registration pages.
* Footer.
* Design Studio.
* Customer dashboard.
* Admin dashboard.
* Order confirmations.
* Branded loading screens.
* Favicon and application icon where suitable.
* Branded documents and exports where appropriate.

Create responsive logo treatments for different screen sizes without altering the original design.

⸻

PART 3 — PRODUCT VISION AND CUSTOMER JOURNEY

The central ModVerse journey is:

DISCOVER → SELECT GARMENT → DESIGN → CUSTOMISE → VISUALISE → VIRTUALLY TRY ON → VALIDATE → ORDER → MANUFACTURE

The customer should be able to:

1. Open the platform.
2. Browse Men’s, Women’s or Kids’ fashion.
3. Select a garment category.
4. Choose a specific garment model.
5. Open a design experience.
6. Describe a design using text.
7. Create text and typography manually.
8. Add graphics from the Creative Library.
9. Upload personal artwork.
10. Modify garment construction.
11. Change fabrics, colours and patterns.
12. Customise individual garment panels.
13. Preview the garment in 3D.
14. View the garment on an avatar.
15. Use the live-camera trial room where supported.
16. Enter body measurements.
17. Save and revisit the design.
18. Validate design and manufacturing constraints.
19. Generate available technical documents.
20. Add the design to the cart.
21. Complete a test checkout locally.
22. Eventually submit the order to a real manufacturing workflow.

All these modules must share a common design data model.

⸻

PART 4 — THREE CORE FASHION CATEGORIES

Build three integrated shopping and design categories.

4.1 MEN

Initial focus:

* T-shirts.
* Shirts.

Extensible catalogue:

* Polo shirts.
* Hoodies.
* Sweatshirts.
* Pants.
* Joggers.
* Shorts.
* Jackets.
* Outerwear.
* Accessories.

Support category-specific:

* Garment models.
* Silhouettes.
* Fits.
* Measurements.
* Size charts.
* Fabric options.
* Construction configurations.
* Collections.
* Product imagery.
* Recommendations.
* Customisation controls.

4.2 WOMEN

Initial focus:

* T-shirts.
* Shirts.

Extensible catalogue:

* Tops.
* Blouses.
* Crop tops.
* Polo shirts.
* Hoodies.
* Sweatshirts.
* Dresses.
* Co-ord sets.
* Pants.
* Jeans.
* Skirts.
* Shorts.
* Jackets.
* Outerwear.
* Accessories.

Support different garment silhouettes, cuts, proportions, fit preferences and construction details.

4.3 KIDS

Initial focus:

* Children’s T-shirts.
* Children’s shirts.

Extensible catalogue:

* Dresses.
* Hoodies.
* Shorts.
* Joggers.
* Matching sets.
* Occasionwear.
* Accessories.

Provide age-appropriate sizing, content and design experiences.

4.4 Shared system

All three categories must use a common:

* Authentication system.
* Product catalogue framework.
* Design engine.
* Creative Library.
* AI Fashion Director.
* 2D editor.
* 3D rendering system.
* Avatar framework.
* Measurement system.
* Manufacturing validation engine.
* Cart and checkout.
* Order management.
* Admin dashboard.

Category-specific differences must be configuration-driven.

4.5 Guardian-managed child profiles

Implement:

* Guardian-controlled child profiles.
* Guardian-managed measurements.
* Guardian-controlled purchases.
* Age-appropriate content.
* Privacy settings.
* Explicit consent where required.
* Data minimisation.
* Profile deletion.
* No public sharing of children’s photographs or measurements by default.
* No independent payment methods or purchases for child profiles.

Review applicable Indian privacy and child-data regulations before production deployment.

4.6 ModVerse Together

Prepare a future-ready coordinated family design feature.

Users should eventually be able to create a shared theme and adapt it to different garments, models, measurements and print areas.

⸻

PART 5 — COMPLETE INITIAL GARMENT CATALOGUE

All listed models must be represented in the initial local catalogue.

Do not simply display different product names for one identical generic garment.

Use distinct garment configurations and parametric geometry wherever feasible.

5.1 T-shirt models

1. Classic crew neck.
2. V-neck.
3. Oversized.
4. Boxy fit.
5. Slim fit.
6. Regular fit.
7. Drop shoulder.
8. Cropped.
9. Longline.
10. Raglan.
11. Henley.
12. Pocket T-shirt.
13. Mock neck.
14. Long sleeve.
15. Short sleeve.

For each model, support the appropriate:

* Body shape.
* Shoulder construction.
* Neckline.
* Sleeve construction.
* Sleeve length.
* Sleeve width.
* Body length.
* Body width.
* Hem.
* Fit.
* Fabric.
* Colour.
* Artwork zones.
* Construction details.

5.2 Shirt models

1. Classic formal shirt.
2. Slim-fit formal shirt.
3. Regular-fit shirt.
4. Oxford button-down shirt.
5. Oversized shirt.
6. Boxy shirt.
7. Drop-shoulder shirt.
8. Casual button-up shirt.
9. Short-sleeve shirt.
10. Cuban/camp collar shirt.
11. Linen shirt.
12. Flannel shirt.
13. Mandarin collar shirt.
14. Band collar shirt.
15. Denim shirt.
16. Western shirt.
17. Longline fashion shirt.

5.3 Shirt construction options

Collars:

* Spread.
* Point.
* Cutaway.
* Button-down.
* Club.
* Mandarin.
* Camp.
* Band.

Plackets:

* Standard.
* French front.
* Hidden.
* Contrast.

Cuffs:

* Barrel.
* French.
* Convertible.
* Adjustable.

Other details:

* Chest pockets.
* Multiple pocket configurations.
* Back yoke.
* Back pleats.
* Darts.
* Curved hem.
* Straight hem.
* Side slits.
* Custom buttons.
* Contrast stitching.
* Embroidery.
* Monograms.
* Custom panel combinations.

Use shared parametric components and garment-specific compatibility rules.

⸻

PART 6 — COMPLETE GARMENT CUSTOMISATION ENGINE

This is a central differentiator of ModVerse.

Customers must be able to customise the garment itself, not merely print a picture on a blank garment.

6.1 Silhouette and fit

Implement supported controls for:

* Regular fit.
* Slim fit.
* Oversized fit.
* Relaxed fit.
* Boxy fit.
* Cropped fit.
* Longline fit.
* Body width.
* Body length.
* Shoulder width.
* Sleeve length.
* Sleeve width.
* Armhole proportions.
* Neckline proportions.
* Hem shape.
* Garment proportions.

Show garment-specific controls only where appropriate.

6.2 Neckline and collar

Allow supported options to be selected and adjusted.

For T-shirts:

* Crew.
* V-neck.
* Mock neck.
* Henley.

For shirts:

* Spread.
* Point.
* Cutaway.
* Button-down.
* Club.
* Mandarin.
* Camp.
* Band.

Changing the selected construction must update the corresponding garment configuration and supported 3D geometry.

6.3 Sleeves and cuffs

Support:

* Short sleeves.
* Long sleeves.
* Raglan sleeves.
* Drop shoulders.
* Different sleeve widths.
* Different sleeve lengths.
* Supported cuff configurations.
* Independent sleeve colours.
* Sleeve artwork.
* Sleeve patterns.

6.4 Fabric and materials

Include:

* Fabric selection.
* Fabric texture.
* GSM.
* Colour.
* Surface appearance.
* Pattern.
* Weave representation.
* Stretch characteristics where supported.
* Roughness and material properties.
* Fabric-specific constraints.

Possible fabric categories include:

* Cotton.
* Organic cotton.
* Cotton blends.
* Linen.
* Denim.
* Jersey.
* Piqué.
* Fleece.
* Flannel.
* Other configurable materials.

Do not claim physical material properties are accurate unless supported by actual material data.

6.5 Independent panels

Allow independent customisation of:

* Front body.
* Back body.
* Left sleeve.
* Right sleeve.
* Collar.
* Cuffs.
* Pocket.
* Placket.
* Shoulder panels.
* Side panels.

Each panel should support compatible:

* Colours.
* Fabrics.
* Patterns.
* Graphics.
* Typography.
* Embroidery zones.

6.6 Construction and finishing

Where supported, customise:

* Seams.
* Hems.
* Stitching.
* Buttons.
* Pockets.
* Zippers.
* Plackets.
* Cuffs.
* Collars.
* Necklines.
* Decorative elements.
* Finishing details.

6.7 Validation

Every displayed control must be connected to the actual saved garment configuration.

If the feature supports 3D geometry or material changes, update the preview.

Never show a fake control that changes only its label without changing the design.

⸻

PART 7 — THREE DESIGN EXPERIENCES

All three modes must be available from the first local testing release.

7.1 DESIGN STUDIO — BEGINNER

Designed for people without professional design knowledge.

Include:

* Guided design workflow.
* Templates.
* Presets.
* Simple garment selection.
* Basic silhouette choices.
* Colour selection.
* Fabric selection.
* Graphic browser.
* Text editor.
* Simple artwork placement.
* AI assistance.
* Live 3D preview.
* Undo.
* Redo.
* Save.
* Reopen design.

The experience should be intuitive without artificially restricting the available creative possibilities.

7.2 ATELIER — ADVANCED

Designed for customers who want detailed creative control.

Include:

* Full supported garment customisation.
* Independent panel editing.
* Fabric and material controls.
* Advanced artwork editing.
* Typography controls.
* Layer management.
* Custom garment proportions.
* Neckline and collar controls.
* Sleeve and cuff controls.
* Advanced print placement.
* Embroidery configuration.
* Avatar preview.
* Advanced 3D viewing.
* Design validation.
* Design history.
* Version management.

7.3 ATELIER PRO — PROFESSIONAL

Designed for experienced designers and technically advanced users.

Include:

* Advanced garment construction.
* Detailed measurement controls.
* Precise proportions.
* Panel-level configuration.
* Material properties.
* Advanced surface controls.
* Print zones.
* Embroidery zones.
* Technical construction details.
* Fit validation.
* Manufacturing constraints.
* Technical specification generation.
* Bill of Materials where supported.
* Tech-pack generation.
* Supported asset exports.
* CAD integration architecture.
* Design version history.
* Precise editing tools.

Do not artificially lock professional controls until a later release.

The three modes should share the same design engine. Their interfaces and workflows should differ according to complexity.

⸻

PART 8 — CUSTOM TEXT AND TYPOGRAPHY EDITOR

This is a mandatory core feature.

Customers must be able to type their own text directly onto garments.

Build a sophisticated typography editor integrated into the 2D editor and 3D preview.

8.1 Text entry

Support:

* Names.
* Initials.
* Numbers.
* Quotes.
* Slogans.
* Phrases.
* Messages.
* Custom sentences.
* Multiline text.
* Unicode and supported multilingual text.

Allow multiple independent text elements on a garment.

8.2 Font selection

Include:

* Searchable font library.
* Font previews.
* Font families.
* Font weights.
* Bold.
* Italic.
* Underline.
* Uppercase.
* Lowercase.
* Font size.
* Alignment.

Use appropriately licensed fonts.

8.3 Typography controls

Include:

* Text colour.
* Letter spacing.
* Line spacing.
* Text opacity.
* Horizontal alignment.
* Vertical alignment.
* Text rotation.
* Scaling.
* Position.
* Line breaks.
* Text width.
* Text height.

8.4 Advanced effects

Support where feasible:

* Curved text.
* Circular text.
* Arched text.
* Vertical text.
* Outlined text.
* Shadow.
* Layered typography.
* Text backgrounds.
* Multiple text styles.
* Distorted or transformed typography where appropriate.

8.5 Placement

Allow text on compatible:

* Front.
* Back.
* Left chest.
* Right chest.
* Sleeves.
* Collar.
* Pockets.
* Other supported panels.

8.6 Editing behaviour

Users must be able to:

* Click an existing text element.
* Edit its content.
* Change its font.
* Change its colour.
* Move it.
* Resize it.
* Rotate it.
* Duplicate it.
* Delete it.
* Reorder its layer.
* Group it where supported.

Provide:

* Alignment guides.
* Safe print boundaries.
* Positioning guides.
* Undo and redo.

8.7 2D and 3D consistency

Text must render consistently in the 2D editor and on the 3D garment.

Use actual font assets and supported texture or geometry rendering, not an HTML label floating over the garment.

8.8 Print validation

Warn about:

* Text that is too small.
* Unsupported fonts.
* Missing font files.
* Poor contrast.
* Text outside the print area.
* Unsupported production methods.
* Potential readability problems.

Prepare supported print-ready exports while preserving text quality and transparency.

⸻

PART 9 — 2D GARMENT DESIGN EDITOR

Build a proper visual design editor.

Include:

* Front garment view.
* Back garment view.
* Panel selection.
* Drag and drop.
* Image upload.
* SVG import.
* Text insertion.
* Typography editing.
* Graphic placement.
* Scaling.
* Rotation.
* Layers.
* Alignment.
* Grouping.
* Undo.
* Redo.
* Duplicate.
* Delete.
* Zoom.
* Grid.
* Guides.
* Print boundaries.
* Asset replacement.
* Composition management.
* Export.

Every supported edit must be stored in the design state.

⸻

PART 10 — MODVERSE CREATIVE LIBRARY

The supplied Creative Library is mandatory.

Do not replace it with generic stock assets or a few placeholder graphics.

Inspect, extract and import the actual library.

Source files:

* ModVerse_Original_Creative_Library_v0.1.zip
* ModVerse_Library_Catalog.pdf

Use the actual extracted directory and manifests.

10.1 Library contents

The supplied library includes:

* 500 procedural editable SVG graphics.
* 20 visual collections.
* 100 seamless SVG pattern tiles.
* 100 graphic-composition templates.
* 100 colour palettes.
* 200 decorative SVG elements and stickers.
* JSON manifests.
* CSV manifests.
* README and collection overview assets.

Collections:

1. Cyberpunk Futurism.
2. Japanese Streetwear.
3. Minimalist Geometric.
4. Vintage Retro.
5. Gothic Dark.
6. Graffiti Urban.
7. Botanical Nature.
8. Abstract Surreal.
9. Space Astronomy.
10. Automotive Racing.
11. Typography.
12. Fantasy Mythology.
13. Sports Athletics.
14. 3D Liquid Chrome.
15. Architecture Brutalism.
16. Pop Comics.
17. Music Psychedelic.
18. Glitch Digital.
19. Luxury Ornamental.
20. Experimental Collage.

10.2 Creative Library browser

Build:

* Collection browsing.
* Search.
* Filters.
* Category navigation.
* Style filters.
* Asset previews.
* Thumbnails.
* Asset details.
* Favourites.
* Recently used assets.
* Pattern browser.
* Palette browser.
* Sticker browser.
* Template browser.

10.3 Asset editing

Users should be able to:

* Add assets to a design.
* Position them.
* Scale them.
* Rotate them.
* Change supported colours.
* Change layers.
* Duplicate them.
* Combine multiple elements.
* Apply patterns.
* Save compositions.
* Reuse previous compositions.
* Export supported assets.

Connect the Library to the 2D editor and 3D garment preview.

10.4 Asset handling

Preserve original asset files and manifests.

Sanitise SVGs before rendering.

Build the browser from the real manifests rather than hardcoding a few example entries.

Keep graphic-composition templates separate from sewing patterns.

The supplied assets are visual graphics and templates, not graded garment patterns, factory CAD files, embroidery stitch files or validated manufacturing specifications.

⸻

PART 11 — TEXT-TO-DESIGN AND CONVERSATIONAL EDITING

This feature is separate from the manual typography editor.

Users should be able to describe a complete garment in natural language.

Examples:

“Create an oversized black T-shirt with a Japanese cyberpunk graphic on the back, red text on the front and dropped shoulders.”

“Design a beige linen shirt with a mandarin collar, hidden placket and brown buttons.”

“Make the sleeves wider and shorten the body by two centimetres.”

“Move the design to the left chest and reduce its size by 20 percent.”

11.1 Design creation

Interpret natural-language descriptions into structured garment configurations.

Recognise:

* Garment type.
* Model.
* Fit.
* Silhouette.
* Measurements.
* Collar.
* Neckline.
* Sleeves.
* Fabric.
* GSM.
* Colours.
* Panels.
* Graphics.
* Text.
* Patterns.
* Placement.
* Construction details.

11.2 Conversational editing

Users must be able to modify existing designs without starting again.

Preserve previous design choices unless the user explicitly changes them.

11.3 Structured execution

The workflow must be:

1. Interpret the instruction.
2. Identify the intended changes.
3. Generate structured configuration data.
4. Validate the configuration.
5. Apply the changes.
6. Update the 2D editor.
7. Update the 3D preview.
8. Save the updated design state.
9. Explain any unsupported or incompatible request.

Do not allow unvalidated model output to execute arbitrary application code.

11.4 Local implementation

Text-to-design must have a local implementation for supported garment options.

Use deterministic parsing, rules, templates and structured configuration.

Prepare Ollama as an optional local language-model integration.

External AI providers must remain optional.

⸻

PART 12 — THE MUSE: AI FASHION DIRECTOR

Build The Muse as the central creative assistant.

Capabilities:

* Design guidance.
* Text-to-design.
* Natural-language editing.
* Colour suggestions.
* Fabric recommendations.
* Style recommendations.
* Graphic recommendations.
* Typography suggestions.
* Design critique.
* Design improvement.
* Outfit coordination.
* Print placement recommendations.
* Garment compatibility checks.
* Fit recommendations.
* Manufacturing feasibility assistance.
* Technical design summaries.

The Muse must interact with the real garment configuration engine.

It should not merely describe a modification without applying it.

Use a provider-independent architecture.

Local implementation:

* Rules.
* Templates.
* Deterministic suggestions.
* Local model support where practical.

Future providers:

* OpenAI API.
* Ollama.
* ComfyUI.
* Compatible image and language models.

Clearly distinguish local rule-based assistance from genuine generative model output.

⸻

PART 13 — IMAGE GENERATION AND PERSONAL ARTWORK

Prepare optional AI artwork generation.

Allow users to:

* Describe an artwork.
* Generate an image using a configured model.
* Preview results.
* Select a result.
* Edit its placement.
* Resize it.
* Rotate it.
* Add it to the garment.
* Combine it with typography and library graphics.

Support local generation through ComfyUI or another compatible system where hardware and model licences permit.

Prepare external provider adapters.

If no image-generation model is configured, the rest of the design application must remain functional.

Do not falsely display generated content when no generation has occurred.

Check commercial licensing and usage restrictions before offering assets or models for commercial production.

⸻

PART 14 — INTERACTIVE 3D GARMENT ENGINE

Build a genuine browser-based 3D system.

Suggested technology:

* Three.js.
* React Three Fiber.
* WebGL.

Include:

* 360-degree rotation.
* Zoom.
* Pan.
* Front view.
* Back view.
* Side view.
* Material previews.
* Fabric textures.
* Lighting controls.
* Colour updates.
* Artwork mapping.
* Independent panels.
* Garment geometry.
* Seams and hems where supported.
* Avatar visualisation.

The 3D garment must update when the customer changes supported garment configuration options.

Build reusable parametric geometry.

Do not use static screenshots or generic spinning objects as a substitute for garment rendering.

Document the geometry completeness of every model.

⸻

PART 15 — AVATAR AND MEASUREMENT-BASED FIT SYSTEM

Build a customisable digital avatar.

Allow customers to enter:

* Height.
* Chest.
* Waist.
* Hip.
* Shoulder width.
* Arm length.
* Sleeve measurements.
* Garment-specific measurements.
* Other supported body measurements.

Include:

* Saved measurement profiles.
* Avatar profiles.
* Size recommendations.
* Fit preferences.
* Garment-specific fit information.

Use actual garment dimensions and available body measurements.

Do not use height and weight alone to claim precise fit.

Distinguish:

* Recommended size.
* Estimated fit.
* Visual representation.
* Verified garment fit.

Do not claim the avatar is an exact physical representation.

⸻

PART 16 — LIVE CAMERA VIRTUAL TRIAL ROOM

Build a real browser-based camera experience.

Expected workflow:

1. User opens the trial room.
2. User grants camera permission.
3. The application detects the person’s body.
4. Pose landmarks identify the shoulders, torso and arms.
5. A garment is positioned over the person.
6. The garment follows movement.
7. The user can inspect the result.

Suggested technologies:

* MediaPipe Pose Landmarker.
* MediaPipe Image Segmenter.
* OpenCV.
* Three.js.
* WebGL.

Implement:

* Live body tracking.
* Shoulder detection.
* Torso tracking.
* Arm tracking.
* Garment alignment.
* Garment scale estimation.
* Segmentation.
* Occlusion where feasible.
* Tracking stabilisation.
* Camera controls.
* Error handling.
* Performance monitoring.

Develop three clearly identified capability levels:

Level A: Basic 2D garment overlay.

Level B: 3D garment attached to body landmarks.

Level C: Advanced deformation, occlusion and more realistic garment interaction.

Do not claim that pose tracking alone creates physically accurate virtual clothing.

Benchmark frame rate, latency and tracking stability on target devices.

Privacy:

* Camera processing locally by default.
* No recording by default.
* No automatic upload of camera footage.
* Clear permission handling.
* Clear stop-camera control.
* Explain data use.

⸻

PART 17 — FIT, SIZING AND MANUFACTURING VALIDATION

Build a structured fit system.

Include:

* Garment measurement charts.
* Body measurement profiles.
* Size recommendations.
* Fit preferences.
* Garment-specific tolerances.
* Measurement validation.
* Fit warnings.
* Design compatibility rules.

Build a manufacturing rules engine.

Check:

* Fabric compatibility.
* Construction compatibility.
* Print-area limits.
* Embroidery-area limits.
* Artwork resolution.
* Text readability.
* Panel constraints.
* Measurement constraints.
* Unsupported design combinations.

Explain why a design fails validation and suggest corrections.

Do not describe estimates as physically verified fit.

⸻

PART 18 — TECHNICAL DOCUMENTATION AND MANUFACTURING

Prepare a structured manufacturing representation for each design.

Store:

* Garment model.
* Silhouette.
* Fit.
* Measurements.
* Fabric.
* GSM.
* Colours.
* Panels.
* Construction details.
* Artwork.
* Text.
* Print positions.
* Embroidery details.
* Finishing.
* Size.
* Version.

Generate where supported:

* Design summary.
* Technical specification.
* Measurement sheet.
* Bill of Materials.
* Tech pack.
* Artwork exports.
* Manufacturing validation report.
* PDF documentation.

Prepare future integrations for professional fashion systems, including CLO 3D and Gerber AccuMark, subject to actual technical and licensing support.

Do not claim that visual previews, procedural geometry or generated PDFs are factory-ready patterns.

Professional pattern grading, sewing construction, fabric specifications and production validation must be reviewed by qualified professionals and the actual manufacturer.

⸻

PART 19 — SAVED DESIGNS AND VERSION CONTROL

Implement:

* Save design.
* Save as new version.
* Reopen design.
* Duplicate design.
* Rename design.
* Delete design.
* Design history.
* Version comparison where feasible.
* Revert to earlier version.
* Draft status.
* Validated status.
* Order-linked design snapshot.

Each saved design must preserve its actual configuration, including:

* Garment model.
* Materials.
* Colours.
* Construction.
* Text.
* Graphics.
* Artwork placement.
* Measurements.
* 2D editor state.
* 3D configuration.
* Relevant asset references.

An order must retain a snapshot of the design used when the order was placed.

⸻

PART 20 — USER ACCOUNTS AND AUTHENTICATION

Build a complete local authentication system without requiring a paid external authentication service.

Customer features:

* Registration.
* Login.
* Logout.
* Email and password.
* Password visibility.
* Password strength checks.
* Secure sessions.
* Password reset workflow.
* Email verification simulation.
* Profile editing.
* Address management.
* Measurement profiles.
* Avatar profiles.
* Saved designs.
* Wishlist.
* Cart.
* Order history.
* Order tracking.
* Account deletion.
* Session management.

Prepare Google and Apple authentication adapters.

Do not display social login as active until credentials are configured.

Admin and staff

Implement:

* Admin accounts.
* Staff accounts.
* Customer accounts.
* Role-based permissions.
* Protected routes.
* Admin dashboard.
* Audit logs.

Security

Use:

* Argon2id or an appropriately secure password hashing implementation.
* HTTP-only secure cookies.
* CSRF protection where applicable.
* Rate limiting.
* Input validation.
* Server-side access control.
* Ownership validation.
* Secure session management.

Never store plaintext passwords.

Never allow one customer to access another customer’s private designs, measurements or orders.

⸻

PART 21 — ECOMMERCE AND CHECKOUT

Build:

* Product catalogue.
* Product detail pages.
* Garment selection.
* Design-to-product workflow.
* Cart.
* Quantity.
* Size.
* Price calculation framework.
* Address management.
* Checkout.
* Order confirmation.
* Order history.
* Order tracking interface.
* Order management.

Prepare Indian payment integration architecture:

* Razorpay.
* UPI.
* Cards.
* Net banking.

Use test mode when configured.

Provide a clearly labelled simulated local checkout when no payment provider is configured.

Never mark a real payment as successful without verified provider confirmation.

Verify payment webhooks server-side.

⸻

PART 22 — ADMIN DASHBOARD

Build an operational dashboard for:

* Customers.
* Staff.
* Products.
* Categories.
* Garment models.
* Garment configurations.
* Fabric options.
* Creative Library assets.
* Designs.
* Design reviews.
* Orders.
* Manufacturing status.
* Integration settings.
* Analytics.
* Audit logs.
* Platform settings.

Provide secure permissions and validation for all administrative actions.

⸻

PART 23 — API INTEGRATION ARCHITECTURE

Implement the integration architecture now.

External API credentials will be added later.

Do not require external credentials to develop or run the local platform.

Create:

* Provider interfaces.
* Adapters.
* Backend service modules.
* API routes.
* Configuration schemas.
* Credential validation.
* Connection tests.
* Error handling.
* Logging.
* Retries where appropriate.
* Environment switching.
* Local fallback services.

23.1 Integration Manager

Create a dedicated admin Integration Manager.

Statuses:

* NOT CONFIGURED.
* TEST MODE.
* LIVE.
* DISABLED.
* ERROR.

Allow:

* Credential entry.
* Connection testing.
* Provider enablement.
* Provider disablement.
* Test/live environment selection.
* Status inspection.
* Error inspection.

Do not claim a connection is successful until it has actually been tested.

Do not activate billable or live services automatically.

23.2 Integration targets

AI:

* OpenAI API.
* Ollama.
* ComfyUI.
* Other compatible providers.

Computer vision and 3D:

* MediaPipe.
* OpenCV.
* Three.js.
* WebGL.
* Blender workflows.
* Supported future virtual try-on services.

Authentication:

* Google OAuth.
* Apple Sign In.
* Email verification.
* SMS and OTP services.

Payments:

* Razorpay.
* UPI.
* Cards.
* Net banking.

Shipping:

* Shiprocket.
* Courier tracking.
* Shipping labels.
* Rate calculations.

Storage:

* Cloudinary.
* S3-compatible storage.
* Local storage.

Communication:

* Email providers.
* Resend or equivalent.
* MSG91 or equivalent.

Other:

* Google Maps where useful.
* PostHog.
* Sentry.
* Cloudflare Turnstile.
* Meilisearch.
* Redis.
* Background job processing.

These are planned integration targets, not active connections.

Verify provider documentation, pricing, availability, permissions and terms before activation.

23.3 Security

* Keep credentials server-side.
* Never expose API secrets in frontend code.
* Never commit secrets to Git.
* Use environment variables or a secure secrets manager.
* Separate test and live credentials.
* Avoid logging credentials.
* Do not incur paid API charges without explicit approval.

23.4 Required integration files

Create:

* INTEGRATIONS.md
* API_SETUP_GUIDE.md
* COST_AND_DEPENDENCIES.md
* PROVIDER_STATUS.md
* .env.example

⸻

PART 24 — FREE LOCAL DEVELOPMENT

The application must run locally without paid API subscriptions or external credentials.

Recommended stack:

Frontend:

* Next.js.
* React.
* TypeScript.
* Tailwind CSS.

3D:

* Three.js.
* React Three Fiber.
* WebGL.

Computer vision:

* MediaPipe.
* OpenCV.

Backend:

* Next.js backend or FastAPI where appropriate.

Database:

* PostgreSQL.
* Versioned migrations.
* Seed data.

Authentication:

* Secure local authentication.
* Auth.js or equivalent where appropriate.

AI:

* Local deterministic logic.
* Ollama where feasible.
* ComfyUI where hardware and licences permit.

Storage:

* Local development storage.
* Provider-independent storage abstraction.

The user’s MacBook Air M5 is the initial development target.

Benchmark actual local performance instead of assuming every AI or 3D model will run smoothly.

Heavy image generation may require a suitable external GPU or configured provider.

24.1 Local fallback requirements

Without external credentials, users must still be able to:

* Register.
* Log in.
* Browse categories.
* Browse garment models.
* Customise supported garments.
* Type text on garments.
* Use the Creative Library.
* Edit graphics.
* Use the 2D editor.
* View supported 3D garments.
* Save designs.
* Enter measurements.
* Use local design assistance.
* Use available camera functionality.
* Generate supported technical documents.
* Add products to a cart.
* Complete a simulated checkout.
* Use the admin dashboard.

Mocks must be labelled as mocks.

⸻

PART 25 — SHIPPING, ORDER FULFILMENT AND MANUFACTURING WORKFLOW

Prepare the application for future real-world operations.

Order statuses should support:

* Draft.
* Cart.
* Pending payment.
* Payment confirmed.
* Design validation.
* Awaiting production approval.
* Manufacturing.
* Quality inspection.
* Packed.
* Shipped.
* Delivered.
* Cancelled.
* Refunded where applicable.

Prepare shipping integrations and tracking architecture.

Prepare manufacturing-provider interfaces.

Do not claim real manufacturing is connected until a real provider has been onboarded and tested.

Support human review and approval for designs that require production validation.

⸻

PART 26 — DESIGN SYSTEM AND RESPONSIVE EXPERIENCE

Build a premium and consistent interface.

Include:

* Landing page.
* Product discovery.
* Category pages.
* Product detail pages.
* Design Studio.
* Atelier.
* Atelier Pro.
* Creative Library.
* 2D editor.
* 3D preview.
* Avatar.
* Virtual trial room.
* The Muse.
* Customer dashboard.
* Admin dashboard.
* Cart.
* Checkout.
* Order tracking.
* Login.
* Registration.
* Profile settings.

Responsive layouts:

* Desktop.
* Tablet.
* Mobile.

The editor must adapt to mobile screens without hiding essential functionality.

Use:

* Accessible controls.
* Keyboard support where applicable.
* Clear labels.
* Useful tooltips.
* Loading states.
* Error states.
* Empty states.
* Confirmation states.
* Consistent navigation.

⸻

PART 27 — DATABASE AND DATA MODEL

Design a structured relational database.

Include appropriate entities for:

* Users.
* Roles.
* Sessions.
* Addresses.
* Guardian profiles.
* Child profiles.
* Measurement profiles.
* Avatar profiles.
* Categories.
* Products.
* Garment models.
* Garment configurations.
* Garment components.
* Fabrics.
* Materials.
* Colour palettes.
* Creative assets.
* Asset collections.
* Design projects.
* Design versions.
* Design layers.
* Text elements.
* Artwork elements.
* Panel configurations.
* Manufacturing specifications.
* Tech packs.
* Carts.
* Cart items.
* Orders.
* Order items.
* Payments.
* Shipping.
* Integration providers.
* Integration configurations.
* Audit logs.

Use migrations, indexes, foreign keys, validation and appropriate data ownership rules.

Avoid unnecessary duplication of design assets and large files in the database.

⸻

PART 28 — TESTING AND QUALITY ASSURANCE

Do not finish after generating pages.

Run the application and verify real functionality.

Test at minimum:

1. Registration and login.
2. Logout.
3. Customer permissions.
4. Men, Women and Kids navigation.
5. T-shirt models.
6. Shirt models.
7. Garment configuration.
8. Colour customisation.
9. Fabric selection.
10. Construction changes.
11. Independent panel customisation.
12. Text insertion.
13. Typography editing.
14. Curved text where supported.
15. Text placement.
16. Image upload.
17. Creative Library browsing.
18. Real library asset usage.
19. Pattern application.
20. 2D editing.
21. 3D garment updates.
22. Design Studio.
23. Atelier.
24. Atelier Pro.
25. Avatar configuration.
26. Measurement entry.
27. Camera permissions.
28. Live body tracking where supported.
29. Local design assistance.
30. Saved designs.
31. Design version history.
32. Manufacturing validation.
33. Technical document generation.
34. Cart.
35. Simulated checkout.
36. Admin management.
37. Integration status.
38. Missing API credential handling.
39. Guardian restrictions.
40. Mobile responsiveness.

Add unit, integration and end-to-end tests for critical workflows.

Run:

* Lint.
* Type checking.
* Database migrations.
* Unit tests.
* Integration tests.
* Build checks.
* Browser workflow tests where available.

Fix errors rather than merely documenting them.

⸻

PART 29 — REQUIRED PROJECT STRUCTURE AND DOCUMENTATION

Create and maintain:

* README.md
* docs/MASTER_PROMPT.md
* docs/ARCHITECTURE.md
* docs/DATABASE_SCHEMA.md
* docs/BRAND_GUIDELINES.md
* docs/GARMENT_SYSTEM.md
* docs/2D_EDITOR.md
* docs/3D_SYSTEM.md
* docs/VIRTUAL_TRY_ON.md
* docs/AI_SYSTEM.md
* docs/TYPOGRAPHY_SYSTEM.md
* docs/CREATIVE_LIBRARY.md
* docs/MANUFACTURING.md
* docs/SECURITY.md
* docs/INTEGRATIONS.md
* docs/API_SETUP_GUIDE.md
* docs/COST_AND_DEPENDENCIES.md
* docs/PROVIDER_STATUS.md
* docs/TESTING.md
* docs/BUILD_STATUS.md
* .env.example

Keep documentation accurate and synchronised with the implementation.

⸻

PART 30 — AUTONOMOUS BUILD INSTRUCTIONS

You are expected to build the maximum feasible scope autonomously.

Do not stop after:

* Creating a plan.
* Creating a folder structure.
* Generating a landing page.
* Building a static prototype.
* Writing TODO lists.
* Writing documentation without implementing the application.

First inspect the repository and all supplied assets.

Then:

1. Inspect the actual logo.
2. Copy it into the project’s public brand directory.
3. Inspect the Creative Library archive.
4. Extract the real library.
5. Read its README and manifests.
6. Create the architecture.
7. Implement the application.
8. Set up the database.
9. Import the actual library assets.
10. Build all design experiences.
11. Build 2D and 3D functionality.
12. Implement local AI and CV features where feasible.
13. Prepare all external provider integrations.
14. Build authentication and commerce.
15. Run the application.
16. Test workflows.
17. Fix errors.
18. Document remaining limitations.

Do not request approval for every module.

Ask only when a decision is genuinely consequential, cannot safely be inferred, or would require spending money, activating a live service, exposing data or committing to a real external transaction.

Never purchase subscriptions, activate paid services, deploy publicly or initiate real payments without explicit permission.

Context management

If a session reaches its context or runtime limit:

* Save completed work.
* Update docs/BUILD_STATUS.md.
* Record the current architecture.
* Record completed features.
* Record incomplete features.
* Record known bugs.
* Record test results.
* Record exact commands to resume.
* Preserve all existing implementation.
* Continue from the saved state in the next session.

Do not restart the project or overwrite completed work unnecessarily.

⸻

PART 31 — DEFINITION OF SUCCESS

ModVerse must become a unified, genuinely functional local fashion-tech platform with:

* The official supplied ModVerse logo.
* The tagline YOUR WORLD. YOUR STYLE.
* Men, Women and Kids categories.
* Multiple distinct T-shirt models.
* Multiple distinct shirt models.
* Complete supported garment customisation.
* Design Studio.
* Atelier.
* Atelier Pro.
* Custom text and typography editing.
* Natural-language text-to-design.
* The Muse AI Fashion Director.
* The actual supplied Creative Library.
* A 2D garment editor.
* Interactive 3D garment visualisation.
* Avatar profiles.
* Measurement-based sizing.
* Live-camera virtual trial room.
* Manufacturing-aware validation.
* Technical document generation.
* Saved designs and versions.
* Customer authentication.
* Guardian-managed child profiles.
* Admin dashboard.
* Cart and checkout.
* Order management.
* API-ready architecture.
* Free local testing.
* Secure code.
* Automated tests.
* Complete technical documentation.

All three design experiences must be accessible in the initial local release.

Text-on-garment editing must be a fully implemented core feature.

The actual supplied logo and Creative Library must be used.

External API integrations must be prepared now, with credentials added later.

The platform must not depend on paid services to provide its core local development experience.

Never misrepresent a prototype as a production-ready feature or an unvalidated visual design as a factory-ready garment.

The final objective is to create a premium, scalable and genuinely useful custom-fashion technology platform that can evolve into a real business.

BEGIN BY INSPECTING THE REPOSITORY, LOGO AND CREATIVE LIBRARY. THEN IMPLEMENT, RUN, TEST, FIX AND DOCUMENT THE APPLICATION. CONTINUE UNTIL THE MAXIMUM FEASIBLE SCOPE HAS BEEN COMPLETED AND VERIFIED.
