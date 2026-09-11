#!/usr/bin/env node
'use strict';
// Actual Shopify smoke test; preview by default, --live verifies the published main theme.
// --cart adds/clears only a fresh isolated browser cart; never creates an order.
// Usage: NODE_PATH=<your global node_modules> node scripts/test-vial-studio-browser.cjs THEME_ID [--live] [--cart] [--mobile-only]
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const themeId=process.argv.find(argument=>/^\d+$/.test(argument));
if(!themeId)throw new Error('Provide the expected Shopify theme ID (preview by default; --live for the published main theme).');
const testCart=process.argv.includes('--cart');
const live=process.argv.includes('--live');
const outputDir=fs.mkdtempSync(path.join(os.tmpdir(),'basenote-vial-browser-'));
function storefrontUrl(pathname='/'){
 const url=new URL(pathname,'https://basenotescent.com');
 if(!live){url.searchParams.set('preview_theme_id',themeId);url.searchParams.set('_fd','0');url.searchParams.set('pb','0');}
 return url.href;
}
async function assertCurrentTheme(page){
 const theme=await page.evaluate(()=>({id:String(Shopify.theme.id),role:Shopify.theme.role}));
 assert.equal(theme.id,themeId,'QA must target the requested Shopify theme');
 if(live){
  assert.equal(theme.role,'main','Public QA must run against the published main theme');
  assert.equal(new URL(page.url()).searchParams.has('preview_theme_id'),false,'Public QA must not use a preview URL');
 }
 return theme.id;
}
const target=storefrontUrl();
function contrastRatio(first,second){
 const luminance=color=>color.match(/[\d.]+/g).slice(0,3).map(value=>Number(value)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
 const values=[luminance(first),luminance(second)].sort((a,b)=>b-a);
 return(values[0]+.05)/(values[1]+.05);
}
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const findings={mode:live?'live':'preview',expectedTheme:themeId,errors:[],commerce:null,viewer:null,mobile:null,filters:null};
 let page,changedCart=false;
 try{
  if(!process.argv.includes('--mobile-only')){
  const context=await browser.newContext({viewport:{width:1440,height:1000}});page=await context.newPage();
  page.on('pageerror',error=>findings.errors.push(error.message));
  await page.goto(target,{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForSelector('vial-studio[data-ready="true"]',{timeout:45000});
  await page.getByRole('button',{name:'Reject',exact:true}).click({timeout:5000}).catch(()=>{});
  const actualTheme=await assertCurrentTheme(page);
  await page.waitForFunction(()=>Boolean(window.BaseNoteCommerce));
  const products=await page.locator('vial-studio').evaluate(el=>el.products);assert.ok(products.length>1&&products.length<=50);
  const first=products.find(product=>product.handle==='creed-aventus');
  const second=products.find(product=>product.handle==='creed-green-irish-tweed');assert.ok(first&&second);
  await page.locator('[data-studio-select]').selectOption(String(first.variantId));
  await page.waitForTimeout(300);
  if(testCart){
  const cartBefore=await page.evaluate(()=>BaseNoteCommerce.getCart());assert.equal(cartBefore.item_count,0,'Fresh isolated browser must have empty cart');
  assert.equal(Number(await page.locator('vial-studio').getAttribute('data-price')),2000);
  changedCart=true;
  await page.locator('[data-studio-add]').click();
  await page.waitForFunction(()=>document.querySelector('[data-studio-status]').textContent.includes('added to your cart'),{timeout:30000});
  const firstCart=await page.evaluate(()=>BaseNoteCommerce.getCart());
  assert.equal(firstCart.item_count,1);assert.equal(firstCart.total_price,2000);assert.equal(firstCart.items[0].variant_id,first.variantId);
  await page.waitForFunction(()=>document.querySelector('vial-studio').dataset.price==='1800',{timeout:20000});
  const additionalLabel=await page.locator('[data-studio-add]').textContent();assert.match(additionalLabel,/18/);
  await page.locator('[data-studio-select]').selectOption(String(second.variantId));
  await page.waitForFunction(id=>document.querySelector('vial-studio').dataset.variantId===String(id),second.variantId);
  await page.locator('[data-studio-add]').click();
  await page.waitForFunction(()=>document.querySelector('[data-studio-status]').textContent.includes('added to your cart'),{timeout:30000});
  const secondCart=await page.evaluate(()=>BaseNoteCommerce.getCart());assert.equal(secondCart.item_count,2);assert.equal(secondCart.total_price,3800);
  const helper=secondCart.items.find(item=>item.handle==='extra-5ml-vial-add-on');assert.ok(helper);assert.equal(helper.properties['_Base Note scent handle'],second.handle);assert.equal(Number(helper.properties['_Base Note scent variant']),second.variantId);assert.equal(helper.selling_plan_allocation,undefined);
  findings.commerce={theme:actualTheme,products:products.length,first:{variantId:firstCart.items[0].variant_id,total:firstCart.total_price},second:{total:secondCart.total_price,helperPrice:helper.final_price,properties:helper.properties},additionalLabel};
  } else { await page.locator('[data-studio-select]').selectOption(String(second.variantId)); }

  await page.locator('vial-studio').scrollIntoViewIfNeeded();await page.waitForTimeout(500);
  await page.locator('vial-studio').screenshot({path:path.join(outputDir,'basenote-actual-studio-selected.png')});
  const rest=await page.locator('vial-studio').evaluate(el=>el.model.inspect());
  await page.locator('[data-studio-action="reverse"]').click();await page.waitForTimeout(650);
  const reverse=await page.locator('vial-studio').evaluate(el=>el.model.inspect());assert.ok(Math.abs(reverse.target.yaw-rest.target.yaw)>3);
  await page.locator('[data-studio-action="open"]').click();await page.waitForTimeout(800);
  const opened=await page.locator('vial-studio').evaluate(el=>el.model.inspect());assert.equal(opened.target.open,1);assert.ok(opened.capY>3.8);
  await page.locator('vial-studio').screenshot({path:path.join(outputDir,'basenote-actual-studio-open.png')});
  await page.locator('[data-studio-action="reset"]').click();await page.waitForTimeout(500);
  const box=await page.locator('[data-studio-canvas]').boundingBox();
  await page.mouse.move(box.x+box.width*.35,box.y+box.height*.45);await page.mouse.down();await page.mouse.move(box.x+box.width*.65,box.y+box.height*.65,{steps:6});await page.mouse.up();
  const dragged=await page.locator('vial-studio').evaluate(el=>el.model.inspect());assert.ok(Math.abs(dragged.target.yaw-rest.target.yaw)>.5);assert.ok(Math.abs(dragged.target.pitch-rest.target.pitch)>.1);
  await page.emulateMedia({reducedMotion:'reduce'});await page.locator('[data-studio-action="reset"]').click();await page.waitForTimeout(300);
  const reduced=await page.locator('vial-studio').evaluate(el=>el.model.inspect());assert.ok(Math.abs(reduced.current.yaw-rest.target.yaw)<.01);assert.equal(reduced.current.open,0);
  const banner=await page.locator('.scent-campaign__image img').getAttribute('src');assert.match(banner,/gLmqu\.jpg/);
  await page.locator('.scent-campaign').scrollIntoViewIfNeeded();await page.waitForTimeout(400);await page.screenshot({path:path.join(outputDir,'basenote-actual-home-desktop-full.png'),fullPage:true});
  await page.locator('vial-studio').scrollIntoViewIfNeeded();
  await page.evaluate(()=>document.querySelector('[data-studio-canvas]').dispatchEvent(new Event('webglcontextlost',{cancelable:true})));
  assert.equal(await page.locator('vial-studio').getAttribute('data-ready'),'false');
  await page.locator('vial-studio').screenshot({path:path.join(outputDir,'basenote-actual-studio-fallback.png')});
  findings.viewer={rest:rest.target,reverse:reverse.target,open:opened.target,drag:dragged.target,reduced:reduced.current,banner,fallback:true};
  if(changedCart){await page.evaluate(async()=>{const response=await(window.__bnFetch||fetch)('/cart/clear.js',{method:'POST'});if(!response.ok)throw new Error('Test cart cleanup failed')});changedCart=false;}
  await context.close();page=null;
  console.log('DESKTOP VERIFIED '+JSON.stringify({commerce:findings.commerce,viewer:findings.viewer,errors:findings.errors}));
  }
  const mobileContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const mobile=await mobileContext.newPage();mobile.on('pageerror',error=>findings.errors.push(error.message));
  await mobile.goto(target,{waitUntil:'domcontentloaded',timeout:60000});await mobile.waitForSelector('vial-studio[data-ready="true"]',{timeout:45000});
  await assertCurrentTheme(mobile);
  await mobile.getByRole('button',{name:'Reject',exact:true}).click({timeout:5000}).catch(()=>{});
  await mobile.waitForTimeout(400);await mobile.screenshot({path:path.join(outputDir,'basenote-actual-home-mobile-top.png')});
  await mobile.locator('[data-mobile-toggle]').click();await mobile.waitForTimeout(200);
  assert.equal(await mobile.locator('[data-mobile-close]').evaluate(el=>el===document.activeElement),true);
  await mobile.keyboard.press('Shift+Tab');const mobileLastInside=await mobile.locator('[data-mobile-nav]').evaluate(el=>el.contains(document.activeElement));assert.ok(mobileLastInside);
  await mobile.keyboard.press('Tab');assert.equal(await mobile.locator('[data-mobile-close]').evaluate(el=>el===document.activeElement),true);
  await mobile.keyboard.press('Escape');assert.equal(await mobile.locator('[data-mobile-toggle]').evaluate(el=>el===document.activeElement),true);
  assert.equal(await mobile.locator('#overlay').evaluate(el=>el.classList.contains('is-active')),false,'Escape must leave no legacy click blocker');
  await mobile.locator('[data-mobile-toggle]').click();await mobile.locator('[data-mobile-close]').click();
  assert.equal(await mobile.locator('[data-mobile-toggle]').getAttribute('aria-expanded'),'false');
  assert.equal(await mobile.locator('[data-mobile-toggle]').evaluate(el=>el===document.activeElement),true);
  await mobile.locator('[data-search-toggle]').click();await mobile.waitForTimeout(250);assert.equal(await mobile.locator('[data-search-input]').evaluate(el=>el===document.activeElement),true);
  await mobile.locator('[data-search-close]').focus();await mobile.keyboard.press('Shift+Tab');
  assert.equal(await mobile.locator('[data-search-overlay]').evaluate(el=>el.contains(document.activeElement)),true,'Search Shift+Tab remains inside the dialog');
  await mobile.keyboard.press('Tab');assert.equal(await mobile.locator('[data-search-close]').evaluate(el=>el===document.activeElement),true,'Search Tab wraps to its close button');
  await mobile.keyboard.press('Escape');assert.equal(await mobile.locator('[data-search-toggle]').evaluate(el=>el===document.activeElement),true);
  await mobile.evaluate(()=>scrollTo(0,600));await mobile.waitForTimeout(200);
  await mobile.evaluate(()=>scrollTo(0,450));await mobile.waitForTimeout(350);
  const scrolledHeader=await mobile.locator('[data-header]').evaluate(el=>({scrolled:el.classList.contains('is-scrolled'),background:getComputedStyle(el).backgroundColor,color:getComputedStyle(el.querySelector('.header__logo-text')||el.querySelector('a')).color}));
  assert.equal(scrolledHeader.scrolled,true);assert.equal(scrolledHeader.background,'rgb(34, 57, 43)');
  const headerContrast=contrastRatio(scrolledHeader.background,scrolledHeader.color);assert.ok(headerContrast>=4.5,'Scrolled header text must retain readable contrast');
  await mobile.locator('[data-header]').screenshot({path:path.join(outputDir,'basenote-actual-header-scrolled-mobile.png')});
  await mobile.locator('.scent-campaign').scrollIntoViewIfNeeded();await mobile.waitForTimeout(400);
  const image=await mobile.locator('.scent-campaign__image').boundingBox();assert.ok(Math.abs(image.width-image.height)<2);assert.match(await mobile.locator('.scent-campaign__image img').getAttribute('src'),/gLmqu\.jpg/);
  await mobile.screenshot({path:path.join(outputDir,'basenote-actual-home-mobile-full.png'),fullPage:true});
  findings.mobile={navFocus:true,searchFocus:true,searchTabTrap:true,legacyOverlayInactive:true,scrolledHeader:{...scrolledHeader,contrast:headerContrast},bannerSquare:true,overflow:await mobile.evaluate(()=>document.documentElement.scrollWidth>innerWidth)};assert.equal(findings.mobile.overflow,false);
  await mobile.goto(storefrontUrl('/collections/fragrances'),{waitUntil:'domcontentloaded',timeout:60000});await mobile.waitForSelector('scent-catalog .scent-card');
  await assertCurrentTheme(mobile);
  const counts={};for(const type of['all','him','her','unisex']){await mobile.locator(`[data-gender-filter="${type}"]`).click();counts[type]=await mobile.locator('[data-scent-card]:not([hidden])').count();assert.ok(counts[type]>0)}
  await mobile.locator('[data-gender-filter="all"]').click();await mobile.locator('[data-scent-search]').fill('Aventus');assert.equal(await mobile.locator('[data-scent-card]:not([hidden])').count(),1);
  await mobile.locator('[data-scent-search]').fill('zzzz-no-match-qa');assert.equal(await mobile.locator('[data-scent-card]:not([hidden])').count(),0);assert.equal(await mobile.locator('[data-scent-empty]').isVisible(),true);
  await mobile.locator('[data-clear-filters]').click();assert.equal(await mobile.locator('[data-scent-card]:not([hidden])').count(),counts.all);
  findings.filters={...counts,search:true,empty:true,clear:true};await mobileContext.close();
  assert.deepEqual(findings.errors,[],'No page JavaScript exceptions');
  console.log(JSON.stringify({...findings,outputDir},null,2));
 }finally{
  if(changedCart&&page&&!page.isClosed()){try{await page.evaluate(()=>(window.__bnFetch||fetch)('/cart/clear.js',{method:'POST'}));console.log('Isolated QA cart cleared in finalizer.')}catch(error){console.log('QA cart cleanup failed:',error.message)}}
  await browser.close();
 }
})().catch(error=>{console.error(error);process.exitCode=1});
