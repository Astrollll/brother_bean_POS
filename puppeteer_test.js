const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('requestfailed', request => {
    console.log('REQUEST FAILED:', request.url(), request.failure().errorText);
  });
  page.on('response', async response => {
    if(!response.ok()) {
      console.log('RESPONSE FAIL:', response.url(), response.status());
    } else if (response.url().endsWith('.js') || response.url().includes('?v=')) {
      const type = response.headers()['content-type'];
      const text = await response.text();
      if(text.trim().startsWith('<')) {
        console.log('JS RETURNED HTML:', response.url());
      }
    }
  });
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message, error.stack));
  
  await page.goto('http://localhost:8000/views/pages/admin.html', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 4000));
  await browser.close();
})();