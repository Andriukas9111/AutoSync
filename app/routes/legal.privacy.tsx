/**
 * Privacy Policy — Public route (no authentication required)
 * Required for Built for Shopify certification
 * URL: /legal/privacy
 */

export default function PrivacyPolicy() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>Privacy Policy — AutoSync</title>
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <style>{`
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--p-color-bg-surface-secondary);
            color: var(--p-color-text);
            line-height: 1.6;
          }
          .legal-container {
            max-width: 800px;
            margin: 0 auto;
            padding: 40px 24px 80px;
          }
          .legal-header {
            text-align: center;
            margin-bottom: 40px;
          }
          .legal-header h1 {
            font-size: 28px;
            font-weight: 700;
            color: var(--p-color-text);
            margin-bottom: 8px;
          }
          .legal-header p {
            color: var(--p-color-text-subdued);
            font-size: 14px;
          }
          .legal-card {
            background: var(--p-color-bg-surface);
            border-radius: 12px;
            border: 1px solid var(--p-color-border-secondary);
            padding: 32px;
            margin-bottom: 24px;
          }
          .legal-card h2 {
            font-size: 18px;
            font-weight: 650;
            color: var(--p-color-text);
            margin-bottom: 16px;
            padding-bottom: 12px;
            border-bottom: 1px solid var(--p-color-border-secondary);
          }
          .legal-card h3 {
            font-size: 15px;
            font-weight: 600;
            color: var(--p-color-text);
            margin: 16px 0 8px;
          }
          .legal-card p {
            font-size: 14px;
            color: var(--p-color-text);
            margin-bottom: 12px;
          }
          .legal-card ul {
            padding-left: 24px;
            margin-bottom: 12px;
          }
          .legal-card li {
            font-size: 14px;
            color: var(--p-color-text);
            margin-bottom: 6px;
          }
          .legal-back {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            color: var(--p-color-text-interactive);
            text-decoration: none;
            font-size: 14px;
            font-weight: 500;
            margin-bottom: 24px;
          }
          .legal-back:hover { text-decoration: underline; }
        `}</style>
      </head>
      <body>
        <div className="legal-container">
          <a href="/" className="legal-back">
            ← Back to AutoSync
          </a>

          <div className="legal-header">
            <h1>Privacy Policy</h1>
            <p>Last updated: March 18, 2026</p>
          </div>

          <div className="legal-card">
            <h2>1. Introduction</h2>
            <p>
              AutoSync ("we", "our", or "us") operates the AutoSync Shopify application.
              This Privacy Policy explains how we collect, use, disclose, and safeguard
              your information when you install and use our application.
            </p>
            <p>
              By installing AutoSync from the Shopify App Store, you agree to the
              collection and use of information in accordance with this policy.
            </p>
          </div>

          <div className="legal-card">
            <h2>2. Information We Collect</h2>

            <h3>2.1 Shopify Store Data</h3>
            <p>When you install AutoSync, we access the following from your Shopify store:</p>
            <ul>
              <li><strong>Products</strong>: Title, description, price, vendor, product type, images, SKU, barcode, tags, and metafields</li>
              <li><strong>Collections</strong>: Smart collection names and rules created by AutoSync</li>
              <li><strong>Store information</strong>: Shop domain, plan information, and installation date</li>
            </ul>

            <h3>2.2 Vehicle Fitment Data</h3>
            <p>
              We process and store vehicle compatibility data (Year/Make/Model/Engine)
              that you configure for your products. This data is generated from your
              product information and our vehicle database.
            </p>

            <h3>2.3 Analytics Data</h3>
            <p>
              We collect anonymised storefront usage data including search queries
              (make, model, year selections), product views, and add-to-cart events
              from customers using the YMME widgets on your store. This data is used
              solely to power your analytics dashboard.
            </p>

            <h3>2.4 What We Do NOT Collect</h3>
            <ul>
              <li>Customer personal information (names, emails, addresses)</li>
              <li>Payment or financial data</li>
              <li>Customer order details</li>
              <li>Cookies or tracking pixels on your customers</li>
            </ul>
          </div>

          <div className="legal-card">
            <h2>3. How We Use Your Information</h2>
            <p>We use the collected information to:</p>
            <ul>
              <li>Extract and map vehicle fitment data to your products</li>
              <li>Generate Shopify tags, metafields, and smart collections</li>
              <li>Power the YMME search widget on your storefront</li>
              <li>Provide analytics and reporting in your dashboard</li>
              <li>Manage your subscription and billing through Shopify</li>
              <li>Improve and maintain the application</li>
            </ul>
          </div>

          <div className="legal-card">
            <h2>4. Data Storage and Security</h2>
            <p>
              Your data is stored securely on Supabase (PostgreSQL) servers. All data
              transmission uses HTTPS encryption. We use Shopify's OAuth 2.0 and session
              tokens for authentication.
            </p>
            <p>
              All data is tenant-isolated — your store data is never accessible to
              other merchants using AutoSync.
            </p>
          </div>

          <div className="legal-card">
            <h2>5. Data Sharing</h2>
            <p>
              We do not sell, trade, or otherwise transfer your information to third
              parties. We may share data only in the following circumstances:
            </p>
            <ul>
              <li><strong>Shopify</strong>: We interact with Shopify's APIs as required to deliver our service</li>
              <li><strong>Legal requirements</strong>: If required by law, court order, or governmental authority</li>
              <li><strong>Service providers</strong>: We use Supabase for database hosting and Vercel for application hosting, both of which maintain their own privacy standards</li>
            </ul>
          </div>

          <div className="legal-card">
            <h2>6. GDPR Compliance</h2>
            <p>
              For merchants and customers in the European Economic Area (EEA) and UK:
            </p>
            <ul>
              <li>We process data based on legitimate interest (providing our service) and your consent (installing the app)</li>
              <li>You can request deletion of all your data by uninstalling the app</li>
              <li>We respond to Shopify GDPR webhooks (customer data requests, customer data erasure, shop data erasure)</li>
              <li>You have the right to access, rectify, or delete your data at any time</li>
            </ul>
          </div>

          <div className="legal-card">
            <h2>7. Data Retention</h2>
            <p>
              We retain your data for as long as you have the app installed. Upon
              uninstallation, we receive a webhook from Shopify and will delete your
              tenant data within 30 days. Analytics event data is automatically
              purged after 90 days.
            </p>
          </div>

          <div className="legal-card">
            <h2>8. Your Rights</h2>
            <p>You have the right to:</p>
            <ul>
              <li>Access and export your data via the Analytics page</li>
              <li>Request deletion of your data by uninstalling the app or contacting us</li>
              <li>Opt out of analytics tracking by disabling the storefront widgets</li>
              <li>Request a copy of all data we hold about your store</li>
            </ul>
          </div>

          <div className="legal-card">
            <h2>9. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. We will notify you
              of any changes by updating the "Last updated" date. Continued use of
              AutoSync after changes constitutes acceptance of the revised policy.
            </p>
          </div>

          <div className="legal-card">
            <h2>10. Contact Us</h2>
            <p>
              If you have questions about this Privacy Policy or your data, contact us at:
            </p>
            <ul>
              <li>Email: support@autosync.app</li>
              <li>Company: PerformanceHQ, Derby, United Kingdom</li>
            </ul>
          </div>
        </div>
      </body>
    </html>
  );
}
