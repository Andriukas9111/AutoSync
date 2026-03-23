/**
 * Terms of Service — Public route (no authentication required)
 * Required for Built for Shopify certification
 * URL: /legal/terms
 */

export default function TermsOfService() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>Terms of Service — AutoSync</title>
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
          .legal-card ul, .legal-card ol {
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
          .legal-table {
            width: 100%;
            border-collapse: collapse;
            margin: 16px 0;
          }
          .legal-table th, .legal-table td {
            padding: 10px 16px;
            text-align: left;
            border-bottom: 1px solid var(--p-color-border-secondary);
            font-size: 14px;
          }
          .legal-table th {
            font-weight: 600;
            background: var(--p-color-bg-surface-secondary);
          }
        `}</style>
      </head>
      <body>
        <div className="legal-container">
          <a href="/" className="legal-back">
            ← Back to AutoSync
          </a>

          <div className="legal-header">
            <h1>Terms of Service</h1>
            <p>Last updated: March 18, 2026</p>
          </div>

          <div className="legal-card">
            <h2>1. Agreement to Terms</h2>
            <p>
              By installing, accessing, or using AutoSync ("the App", "the Service"),
              you agree to be bound by these Terms of Service ("Terms"). If you do not
              agree to these Terms, do not install or use the App.
            </p>
            <p>
              AutoSync is operated by PerformanceHQ ("we", "us", "our"), a company
              registered in Derby, United Kingdom.
            </p>
          </div>

          <div className="legal-card">
            <h2>2. Description of Service</h2>
            <p>
              AutoSync is a Shopify application that helps automotive e-commerce
              merchants manage vehicle fitment data (Year/Make/Model/Engine) for their
              products. The Service includes:
            </p>
            <ul>
              <li>Automatic extraction of vehicle fitment data from product information</li>
              <li>Manual vehicle-to-product mapping tools</li>
              <li>Shopify tag, metafield, and smart collection generation</li>
              <li>Storefront YMME search widgets for customer vehicle selection</li>
              <li>UK registration plate lookup and VIN decode (on eligible plans)</li>
              <li>Wheel finder functionality (on eligible plans)</li>
              <li>Competitive pricing engine (on eligible plans)</li>
              <li>Analytics and reporting dashboard</li>
            </ul>
          </div>

          <div className="legal-card">
            <h2>3. Subscription Plans and Billing</h2>

            <h3>3.1 Plan Tiers</h3>
            <p>
              AutoSync offers multiple subscription tiers with varying feature access,
              product limits, and fitment limits. Current plan details are available
              on the Plans page within the app.
            </p>

            <h3>3.2 Billing</h3>
            <p>
              All billing is handled through the Shopify Billing API. Charges appear
              on your Shopify invoice. By subscribing to a paid plan, you authorise
              Shopify to charge your account on a recurring basis.
            </p>

            <h3>3.3 Free Plan</h3>
            <p>
              The Free plan provides limited access with restricted product and fitment
              counts. No credit card is required for the Free plan.
            </p>

            <h3>3.4 Cancellation</h3>
            <p>
              You may cancel your subscription at any time by uninstalling the app from
              your Shopify admin. Cancellation takes effect at the end of the current
              billing period.
            </p>

            <h3>3.5 Refunds</h3>
            <p>
              Refunds are handled through Shopify's standard refund process. Contact
              us if you believe you are entitled to a refund.
            </p>
          </div>

          <div className="legal-card">
            <h2>4. Acceptable Use</h2>
            <p>You agree not to:</p>
            <ul>
              <li>Use the Service for any unlawful purpose</li>
              <li>Attempt to reverse-engineer, decompile, or extract the source code of the application</li>
              <li>Circumvent plan limitations or billing gates</li>
              <li>Submit false or misleading fitment data that could endanger vehicle safety</li>
              <li>Use automated tools to overload the Service's infrastructure</li>
              <li>Resell, sublicense, or redistribute the Service to third parties</li>
              <li>Use the Service to scrape or harvest vehicle data for purposes unrelated to your Shopify store</li>
            </ul>
          </div>

          <div className="legal-card">
            <h2>5. Data and Content</h2>

            <h3>5.1 Your Data</h3>
            <p>
              You retain ownership of all product data, fitment mappings, and content
              you create within AutoSync. We claim no ownership over your data.
            </p>

            <h3>5.2 Vehicle Database</h3>
            <p>
              The YMME vehicle database (makes, models, engines, specifications) is
              proprietary to AutoSync. You may use this data only within the context
              of the AutoSync application and your Shopify store.
            </p>

            <h3>5.3 Data Accuracy</h3>
            <p>
              While we strive for accuracy, vehicle fitment data is provided "as is."
              You are responsible for verifying fitment accuracy before publishing to
              your store. AutoSync is not liable for incorrect fitment information
              displayed on your storefront.
            </p>
          </div>

          <div className="legal-card">
            <h2>6. Shopify Integration</h2>
            <p>
              AutoSync integrates with your Shopify store through the Shopify API.
              The app creates and manages:
            </p>
            <ul>
              <li><strong>Tags</strong>: App-prefixed tags (<code>_autosync_*</code>) that do not conflict with your existing tags</li>
              <li><strong>Metafields</strong>: App-owned metafields in the <code>$app:vehicle_fitment</code> namespace</li>
              <li><strong>Smart Collections</strong>: Automated collections based on vehicle makes and models</li>
            </ul>
            <p>
              All AutoSync-created resources are clearly identified and can be removed
              through the Settings page's cleanup tools.
            </p>
          </div>

          <div className="legal-card">
            <h2>7. Intellectual Property</h2>
            <p>
              The AutoSync application, including its code, design, vehicle database,
              extraction algorithms, and documentation, is the intellectual property of
              PerformanceHQ. These Terms grant you a limited, non-exclusive,
              non-transferable licence to use the Service as intended.
            </p>
          </div>

          <div className="legal-card">
            <h2>8. Limitation of Liability</h2>
            <p>
              To the maximum extent permitted by law, AutoSync and its operators shall
              not be liable for:
            </p>
            <ul>
              <li>Indirect, incidental, special, or consequential damages</li>
              <li>Loss of profits, revenue, data, or business opportunities</li>
              <li>Damages arising from incorrect fitment data or product information</li>
              <li>Service interruptions, downtime, or data loss</li>
              <li>Damages exceeding the amount paid to us in the 12 months preceding the claim</li>
            </ul>
          </div>

          <div className="legal-card">
            <h2>9. Warranty Disclaimer</h2>
            <p>
              THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES
              OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
              WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, OR
              NON-INFRINGEMENT.
            </p>
          </div>

          <div className="legal-card">
            <h2>10. Service Availability</h2>
            <p>
              We aim to maintain high availability but do not guarantee uninterrupted
              service. We may perform maintenance, updates, or modifications that
              temporarily affect availability. We will endeavour to provide advance
              notice of planned maintenance.
            </p>
          </div>

          <div className="legal-card">
            <h2>11. Termination</h2>
            <p>
              We reserve the right to suspend or terminate your access to the Service
              if you violate these Terms, engage in fraudulent activity, or fail to
              maintain an active Shopify subscription.
            </p>
            <p>
              Upon termination, we will delete your data in accordance with our Privacy
              Policy.
            </p>
          </div>

          <div className="legal-card">
            <h2>12. Governing Law</h2>
            <p>
              These Terms are governed by the laws of England and Wales. Any disputes
              arising from these Terms or the Service shall be subject to the exclusive
              jurisdiction of the courts of England and Wales.
            </p>
          </div>

          <div className="legal-card">
            <h2>13. Changes to Terms</h2>
            <p>
              We may modify these Terms at any time. Material changes will be
              communicated through the app or via email. Continued use of the Service
              after changes constitutes acceptance of the revised Terms.
            </p>
          </div>

          <div className="legal-card">
            <h2>14. Contact Information</h2>
            <p>
              For questions or concerns about these Terms, contact us at:
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
