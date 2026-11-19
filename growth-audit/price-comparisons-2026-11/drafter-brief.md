# Drafter brief: one 5 ml price comparison post (today is 2026-11-19)

Guard: do not consult any advisor. Do not read large files other than the three named below. Write exactly ONE file, the path your task names. Stop when it is written.

Read first (all in this folder):
1. `evidence-2026-11-19.md` : the ONLY source for prices, shipping and rules. Read the top sections and your scent's section.
2. `basenote-facts.md` : your scent's notes and product description.
3. `model-post-imagination.html` : the live post whose structure you follow (it converts well). Copy its structure and tone, not its numbers.

## What to write
An HTML fragment (no <html>, no <h1>, no <style>, no <figure> or image tags) of 900 to 1,250 words, in this order:
1. Opening paragraph, bold first sentence stating Base Note's price for a 5 ml decant of the scent ($20, $4 per ml) and, in the same paragraph, the honest range of the other retailers checked on November 19, 2026, including any retailer that is cheaper or equal. Lead with the true picture.
2. A `<p><small>` line: "Prices checked November 19, 2026. Item prices before tax, shipping and coupons."
3. A short bullet list: size and format, one-time price, packaging, subscription (as in the model post).
4. `<nav aria-label="Article sections">` jump links to the h2 ids you use.
5. `<h2 id="price-comparison">` : one paragraph on what was compared, then the table wrapped exactly like the model post (`<div class="bn-table-scroll" style="overflow-x:auto;-webkit-overflow-scrolling:touch;margin:1.25em 0;"><table>` with `<caption>`, `<thead>`, `<tbody>`). Columns: Retailer, 5 ml item price, Price per ml, Difference from Base Note's $20. First row is Base Note (link to its product page, "Comparison baseline"). Then every retailer row from the evidence table, sorted by price, each retailer name linked to the product URL given. Where a retailer is cheaper, the last cell says so plainly (for example "$0.01 less than Base Note"). Then a `<p><small>` note on rounding, denominators and that atomizers, packaging and services differ.
6. A short paragraph on other 5 ml options some retailers list (from the evidence bullets) and which retailers had no 5 ml listing, if the evidence says so.
7. `<h2>` Compare the final order total: shipping facts from the evidence (quote the policy wording given, link each policy URL), Base Note's own shipping rule, and the plain statement that shipping can change the ranking on a single vial. No delivered totals for other retailers.
8. `<h2 id="what-you-receive">` What is inside a Base Note vial of this scent: genuine fragrance decanted by hand from the original bottle into a 5 ml glass spray atomizer; Jeff decants; the brand's bottle and box are not included; notes list verbatim from basenote-facts.md.
9. `<h2>` Why try it before buying the bottle: no bottle price. Link the two internal guides below.
10. `<h3>` Is this an official <brand> sample? (No. Independent Base Note decant. Base Note is not affiliated with or endorsed by the brand.)
11. `<h2 id="buying-options">` Buy once, or the optional monthly plan: $20 one-time; subscription $15 first delivery then $20 per monthly delivery; the sale price ONLY if the evidence gives one for your scent, dated November 19, 2026 and described as temporary; three vials in a box set are $56 regular.
12. `<h2 id="comparison-method">` How we compared: read each retailer's own product data on November 19, 2026; selected the plain 5 ml variant; coupons not checked; prices change; this is a dated comparison of selected retailers, not a claim about every seller.
13. Sign-off: `<p><em>Wilson Wu<br>Cofounder, Base Note</em></p>`
14. Last line, a META comment exactly in this shape (valid JSON inside):
`<!--META {"title": "...", "summary": "...", "tags": ["...", "..."], "images": [{"id": "hero", "aspect": "16:9", "alt": "..."}]} META-->`
   Title: "<Brand and scent> 5ml Decant: Price Comparison", at most 60 characters. Summary: one or two sentences, at most 200 characters, honest about the result. Tags: 5 or 6, including "5ml decants" and "Price comparison". Hero alt: "Typographic card reading <scent>, by the vial, $20 for 5 ml at Base Note".

## Frozen rules
- Every dollar figure, percentage and per-ml figure must appear in the evidence file for your scent (or in the Base Note facts). Never compute a new number. Never state a full bottle price.
- Never call Base Note the cheapest unless your scent's table shows it, and then only "among the retailers we checked on November 19, 2026".
- Write "we" for Base Note. No first-person founding story. Jeff by first name only. Do not mention any other business.
- No em-dashes or en-dashes anywhere (use commas, periods or "to"). Plain words. No hype words ("unlock", "elevate", "game-changer").
- No customer reviews, no claims about other retailers' authenticity, quality or service.
- Internal links allowed (use only these, full URLs): the scent's own product page from the evidence; https://basenotescent.com/blogs/hub/sample-before-you-buy-full-bottle ; https://basenotescent.com/blogs/hub/how-long-does-5ml-fragrance-atomizer-last ; https://basenotescent.com/blogs/hub/louis-vuitton-imagination-5ml-price-comparison ; https://basenotescent.com/products/build-your-own-box-set ; plus the one extra link your task names, if any.
- External links allowed: only the product URLs and shipping policy URLs in the evidence file.
- Use "5 ml" with a space in body text; "5ml" only in the title.

Return (short): the file path, word count, and any place where the evidence was missing or ambiguous.
