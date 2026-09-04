import { chromium } from "playwright";
import path from "node:path";

// Deterministic technical fixture, never a photographer's portfolio asset.
const directory = process.argv[2];
if (!directory || !path.isAbsolute(directory))
  throw new Error("Provide an absolute output directory");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 800 },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<html><body style="margin:0;background:#18212b;color:white;font-family:Arial,sans-serif"><main style="padding:100px;border:24px solid #b4c5d4;box-sizing:border-box;width:1200px;height:800px"><p style="font-size:28px;letter-spacing:5px">WGP / TECHNICAL ACCEPTANCE</p><h1 style="font-size:80px;line-height:1.1">PAYMENT TEST</h1><p style="font-size:36px">Synthetic image · NOT FOR SALE</p><p style="font-size:26px">No customer photograph. No real payment.</p><p style="font-size:22px">Used to verify private storage, paid delivery and refund revocation.</p></main></body></html>`,
  );
  const output = path.join(directory, "PAYMENT-TEST-NOT-FOR-SALE.png");
  await page.screenshot({ path: output });
  console.log(output);
} finally {
  await browser.close();
}
