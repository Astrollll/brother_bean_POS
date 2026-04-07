const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('LOG:', msg.text()));
  page.on('pageerror', error => console.log('ERROR:', error.message, '\nSTACK:', error.stack));
  page.on('response', async response => {
    const status = response.status();
    const url = response.url();
    console.log(status, url);
    if(status === 200 && url.endsWith('.js') || url.includes('.js?')) {
      const text = await response.text();
      if(text.trim().startsWith('<')) {
        console.log('!!! JS FILE IS HTML !!!', url);
        console.log(text.substring(0, 100));
      }
    }
  });
  
  await page.goto('http://localhost:8000/test.html', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 3000));
  await browser.close();
})();