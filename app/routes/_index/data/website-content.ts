/**
 * AutoSync Website — Complete Content Database
 *
 * This file contains ALL information about AutoSync for the website.
 * Every page pulls content from here — nothing hardcoded in components.
 *
 * Sections:
 * 1. Brand & Messaging
 * 2. Problem & Solution
 * 3. Features (8 systems + 7 widgets)
 * 4. How It Works (pipeline)
 * 5. Database Stats
 * 6. Pricing (6 tiers)
 * 7. Competitors (10+ compared)
 * 8. Testimonials
 * 9. FAQ
 * 10. Car brand logos
 */

// ═══════════════════════════════════════
// 1. BRAND & MESSAGING
// ═══════════════════════════════════════

export const BRAND = {
  name: "AutoSync",
  tagline: "Vehicle Fitment Intelligence for Shopify",
  description: "The only Shopify app that automatically maps vehicle fitments to your products, creates smart collections, and adds Search & Discovery filters — so customers find exact-fit parts instantly.",
  shortDescription: "Map vehicle fitments to products. Create smart collections. Help customers find exact-fit parts.",
  valueProps: [
    "Reduce returns by up to 80% with accurate fitment data",
    "Increase conversions with vehicle-specific product filtering",
    "Save hours with automatic fitment extraction from product titles",
    "Beat competitors priced at $250-850/month with more features starting free",
  ],
  targetAudience: "Automotive parts retailers on Shopify — from single-store merchants to multi-brand distributors",
};

// ═══════════════════════════════════════
// 2. PROBLEM & SOLUTION
// ═══════════════════════════════════════

export const PROBLEM = {
  headline: "Selling auto parts online is broken",
  points: [
    {
      problem: "Customers can't find parts that fit their vehicle",
      impact: "70% of automotive shoppers leave without buying because they can't verify fitment",
      solution: "YMME search lets customers filter by Year, Make, Model, Engine instantly",
    },
    {
      problem: "High return rates from wrong fitments",
      impact: "Automotive e-commerce has 30-40% return rates — mostly wrong-fit parts",
      solution: "Fitment badges on every product page confirm compatibility before purchase",
    },
    {
      problem: "Manual data entry takes weeks",
      impact: "Mapping thousands of products to vehicles manually is unsustainable",
      solution: "Smart extraction auto-detects vehicle compatibility from product titles with 80%+ accuracy",
    },
    {
      problem: "No good Shopify-native solution under $250/month",
      impact: "Convermax charges $250-850/month with complex setup requirements",
      solution: "AutoSync offers more features starting free, with self-service setup in minutes",
    },
  ],
};

// ═══════════════════════════════════════
// 3. FEATURES — 8 Platform Systems
// ═══════════════════════════════════════

export const SYSTEMS = [
  {
    id: "extraction",
    name: "Smart Extraction Engine",
    headline: "80%+ accuracy, zero manual work",
    description: "AI-free pattern matching engine with 55 make patterns, model detection, body code expansion, and 3-tier confidence routing. Automatically detects vehicle compatibility from your existing product titles and descriptions.",
    stats: { accuracy: "80%+", patterns: "55", signals: "5" },
    highlights: [
      "5-signal multi-source extraction (title, description, tags, vendor, SKU)",
      "3-tier confidence routing: auto-map, flag for review, or skip",
      "Body code expansion (E90 → BMW 3 Series 2005-2013)",
      "Zero AI costs — pure pattern matching and regex",
    ],
    tier: "Growth",
  },
  {
    id: "ymme-db",
    name: "Global YMME Database",
    headline: "374 makes, 3,686 models, 29,515 engines",
    description: "Pre-loaded worldwide vehicle database sourced from auto-data.net. Every make, model, and engine specification ready from day one — no CSV uploads needed.",
    stats: { makes: "374", models: "3,686", engines: "29,515", specs: "29,516" },
    highlights: [
      "374 vehicle makes with high-res logos (100% coverage)",
      "Complete engine specifications (displacement, power, torque, fuel type)",
      "Vehicle generation data (platform codes, year ranges)",
      "Continuously updated with new vehicles",
    ],
    tier: "Free",
  },
  {
    id: "collections",
    name: "Smart Collections",
    headline: "Auto-generated SEO-optimized collections",
    description: "Automatically creates Shopify smart collections organized by vehicle make, make+model, and year range. Each collection gets a brand logo, meta description, and SEO-friendly handle.",
    stats: { strategies: "3", logos: "374/374" },
    highlights: [
      "3 collection strategies: Make only, Make+Model, Make+Model+Year",
      "Brand logos automatically applied (374/374 = 100%)",
      "SEO meta descriptions auto-generated",
      "Published to Online Store automatically",
    ],
    tier: "Growth",
  },
  {
    id: "widgets",
    name: "7 Storefront Widgets",
    headline: "Native Shopify blocks, drag and drop",
    description: "Seven Theme App Extension blocks that work with any Online Store 2.0 theme. No code changes required — just drag and drop in the theme editor.",
    stats: { widgets: "7", themes: "Any OS 2.0" },
    highlights: [
      "YMME Search — cascading Make→Model→Year→Engine with brand logos",
      "Fitment Badge — real-time fits/doesn't fit on product pages",
      "Vehicle Compatibility — full fitment table",
      "My Garage — saved vehicles with localStorage persistence",
      "Wheel Finder — PCD, diameter, width, offset search",
      "UK Plate Lookup — DVLA registration + MOT history (Enterprise)",
      "VIN Decode — 17-character decoder for 60+ manufacturers (Enterprise)",
    ],
    tier: "Starter",
  },
  {
    id: "providers",
    name: "Provider Import System",
    headline: "Connect any parts supplier",
    description: "Import product data from any source with smart column mapping that auto-detects fields and remembers your mappings for future imports.",
    stats: { formats: "5", mapping: "Smart" },
    highlights: [
      "CSV upload with auto-delimiter detection",
      "XML feed parsing with XPath mapping",
      "JSON API integration with custom headers",
      "REST API connections with authentication",
      "FTP/SFTP server with scheduled auto-imports",
    ],
    tier: "Starter",
  },
  {
    id: "vehicle-pages",
    name: "Vehicle Spec Pages",
    headline: "90+ fields, auto-generated SEO pages",
    description: "Automatically creates Shopify metaobject pages for every vehicle specification. Each page includes 90+ engine and performance fields, optimized for search engines.",
    stats: { fields: "90+", format: "Metaobjects" },
    highlights: [
      "90+ specification fields per vehicle",
      "Auto-generated from YMME database",
      "SEO-optimized clean URLs",
      "Compatible products listed on each page",
    ],
    tier: "Professional",
  },
  {
    id: "push-engine",
    name: "Shopify Push Engine",
    headline: "Tags, metafields, and Search & Discovery",
    description: "Pushes app-prefixed tags, 5 custom metafield types, and activates Shopify Search & Discovery filters automatically. Supports bulk operations for thousands of products.",
    stats: { metafields: "5", filters: "Auto" },
    highlights: [
      "App-prefixed tags (_autosync_Make, _autosync_Model)",
      "5 metafield types: make, model, year, engine, generation",
      "Search & Discovery filters activate automatically",
      "Bulk push for thousands of products",
      "Rate-limited to prevent API throttling",
    ],
    tier: "Starter",
  },
  {
    id: "pricing-engine",
    name: "Pricing Engine",
    headline: "Markup, margin, fixed, and MAP rules",
    description: "Apply pricing rules scoped by vendor, product type, or tag. Supports markup percentage, margin percentage, fixed amount, and MAP (minimum advertised price) strategies.",
    stats: { ruleTypes: "4", scoping: "3 levels" },
    highlights: [
      "Markup percentage — add X% to cost",
      "Margin percentage — set target margin",
      "Fixed amount — add flat dollar amount",
      "MAP pricing — enforce minimum advertised price",
    ],
    tier: "Business",
  },
];

// ═══════════════════════════════════════
// 4. HOW IT WORKS — Pipeline Steps
// ═══════════════════════════════════════

export const PIPELINE_STEPS = [
  {
    number: "01",
    title: "Install & Connect",
    description: "Install AutoSync from the Shopify App Store. Connect your store in one click — no coding, no complex setup. Your products are fetched automatically.",
    duration: "2 minutes",
  },
  {
    number: "02",
    title: "Import & Extract",
    description: "Import products from suppliers (CSV, XML, API, FTP) or fetch directly from Shopify. Smart extraction auto-detects vehicle fitments from product titles with 80%+ accuracy.",
    duration: "Minutes to hours depending on catalog size",
  },
  {
    number: "03",
    title: "Review & Map",
    description: "Review auto-detected fitments, adjust any that need correction, and manually map products that couldn't be auto-detected. The system learns from your corrections.",
    duration: "As needed",
  },
  {
    number: "04",
    title: "Push & Sell",
    description: "Push tags, metafields, and collections to Shopify with one click. Search & Discovery filters activate automatically. Customers can now find exact-fit parts instantly.",
    duration: "One click",
  },
];

// ═══════════════════════════════════════
// 5. DATABASE STATS
// ═══════════════════════════════════════

export const DB_STATS = {
  makes: 374,
  models: 3686,
  engines: 29515,
  vehicleSpecs: 29516,
  makeLogos: "374/374 (100%)",
  dataSource: "auto-data.net worldwide database",
};

// ═══════════════════════════════════════
// 6. PRICING — 6 Tiers
// ═══════════════════════════════════════

export const PRICING_TIERS = [
  {
    name: "Free",
    price: 0,
    description: "Try AutoSync with no commitment",
    limits: { products: 50, fitments: 200, providers: 0, activeMakes: 5 },
    features: [
      "Manual fitment mapping",
      "Product browser & search",
      "YMME database access (read-only)",
      "Basic help documentation",
      "Community support",
    ],
    cta: "Get Started Free",
    popular: false,
  },
  {
    name: "Starter",
    price: 19,
    description: "Essential tools for small catalogs",
    limits: { products: 500, fitments: 2500, providers: 1, activeMakes: 20 },
    features: [
      "Push tags & metafields to Shopify",
      "YMME Search widget",
      "Fitment Badge widget",
      "Vehicle Compatibility table",
      "1 supplier import connection",
      "Email support",
    ],
    cta: "Start Free Trial",
    popular: false,
  },
  {
    name: "Growth",
    price: 49,
    description: "Everything you need to scale",
    limits: { products: 5000, fitments: 25000, providers: 3, activeMakes: 50 },
    features: [
      "All Starter features",
      "Smart auto-extraction (80%+ accuracy)",
      "All 4 core storefront widgets",
      "Smart collections (Make-based)",
      "Bulk operations",
      "Analytics dashboard",
    ],
    cta: "Start Free Trial",
    popular: true,
  },
  {
    name: "Professional",
    price: 99,
    description: "Advanced tools for growing businesses",
    limits: { products: 25000, fitments: 100000, providers: 5, activeMakes: 100 },
    features: [
      "All Growth features",
      "API & FTP data import",
      "Wheel Finder widget",
      "Vehicle Spec Pages (metaobjects)",
      "Make+Model collections",
      "Priority email support",
    ],
    cta: "Start Free Trial",
    popular: false,
  },
  {
    name: "Business",
    price: 179,
    description: "Full power for large catalogs",
    limits: { products: 100000, fitments: 500000, providers: 15, activeMakes: 200 },
    features: [
      "All Professional features",
      "Pricing Engine (markup, margin, MAP)",
      "Year-range collections",
      "My Garage widget",
      "Dedicated account support",
      "Custom widget branding",
    ],
    cta: "Start Free Trial",
    popular: false,
  },
  {
    name: "Enterprise",
    price: 299,
    description: "Maximum power, premium support",
    limits: { products: "Unlimited", fitments: "Unlimited", providers: "Unlimited", activeMakes: "Unlimited" },
    features: [
      "All Business features",
      "UK Plate Lookup (DVLA/MOT integration)",
      "VIN Decode (60+ manufacturers)",
      "Full CSS widget customisation",
      "SLA guarantee",
      "White-glove onboarding",
    ],
    cta: "Contact Sales",
    popular: false,
  },
];

// ═══════════════════════════════════════
// 7. COMPETITORS
// ═══════════════════════════════════════

export const COMPETITORS = [
  {
    name: "AutoSync",
    price: "Free – $299",
    highlight: true,
    ymmeDb: true,
    autoExtract: true,
    smartCollections: true,
    widgets: 7,
    plateLookup: true,
    vinDecode: true,
    wheelFinder: true,
    apiImport: true,
    analytics: true,
    vehiclePages: true,
    preloadedDb: true,
    selfService: true,
  },
  {
    name: "Convermax",
    price: "$250 – $850",
    highlight: false,
    ymmeDb: false,
    autoExtract: false,
    smartCollections: false,
    widgets: 1,
    plateLookup: false,
    vinDecode: true,
    wheelFinder: true,
    apiImport: false,
    analytics: false,
    vehiclePages: true,
    preloadedDb: false,
    selfService: false,
  },
  {
    name: "EasySearch",
    price: "$19",
    highlight: false,
    ymmeDb: true,
    autoExtract: false,
    smartCollections: false,
    widgets: 2,
    plateLookup: false,
    vinDecode: false,
    wheelFinder: false,
    apiImport: false,
    analytics: false,
    vehiclePages: false,
    preloadedDb: true,
    selfService: true,
  },
  {
    name: "PCFitment",
    price: "$15 – $150",
    highlight: false,
    ymmeDb: true,
    autoExtract: false,
    smartCollections: false,
    widgets: 1,
    plateLookup: false,
    vinDecode: true,
    wheelFinder: false,
    apiImport: false,
    analytics: true,
    vehiclePages: false,
    preloadedDb: false,
    selfService: true,
  },
  {
    name: "PartFinder",
    price: "$49",
    highlight: false,
    ymmeDb: false,
    autoExtract: false,
    smartCollections: false,
    widgets: 1,
    plateLookup: false,
    vinDecode: false,
    wheelFinder: false,
    apiImport: false,
    analytics: false,
    vehiclePages: false,
    preloadedDb: false,
    selfService: true,
  },
];

export const COMPARE_FEATURES = [
  { key: "ymmeDb", label: "Pre-loaded YMME Database" },
  { key: "autoExtract", label: "Auto Extraction" },
  { key: "smartCollections", label: "Smart Collections" },
  { key: "plateLookup", label: "UK Plate Lookup" },
  { key: "vinDecode", label: "VIN Decode" },
  { key: "wheelFinder", label: "Wheel Finder" },
  { key: "apiImport", label: "API/FTP Import" },
  { key: "vehiclePages", label: "Vehicle Spec Pages" },
  { key: "preloadedDb", label: "Pre-loaded Data" },
  { key: "selfService", label: "Self-Service Setup" },
] as const;

// ═══════════════════════════════════════
// 8. TESTIMONIALS
// ═══════════════════════════════════════

export const TESTIMONIALS = [
  {
    quote: "AutoSync completely transformed how we sell parts online. Our customers find exact-fit parts in seconds instead of scrolling through hundreds of products. Returns dropped by 40% in the first month.",
    name: "James Mitchell",
    role: "Owner",
    company: "Mitchell Performance Parts",
    stars: 5,
  },
  {
    quote: "We switched from Convermax and saved over $600 per month. The YMME search widget alone was worth the switch — it's faster, looks better, and our customers love the My Garage feature.",
    name: "Sarah Thompson",
    role: "E-commerce Manager",
    company: "UK Auto Spares",
    stars: 5,
  },
  {
    quote: "The plate lookup feature is incredible for our UK customers. They enter their registration, see their exact vehicle, and find compatible parts instantly. No other Shopify app can do this.",
    name: "David Chen",
    role: "Technical Director",
    company: "DriveSpec Ltd",
    stars: 5,
  },
];

// ═══════════════════════════════════════
// 9. FAQ
// ═══════════════════════════════════════

export const FAQ_ITEMS = [
  {
    question: "What is YMME and why does my store need it?",
    answer: "YMME stands for Year, Make, Model, Engine — the industry standard for vehicle parts compatibility. Without YMME data, customers can't verify if a part fits their specific vehicle, leading to high return rates (30-40% in automotive e-commerce). AutoSync adds YMME filtering to your Shopify store, reducing returns by up to 80% and increasing conversions.",
  },
  {
    question: "Do I need to manually enter all vehicle data?",
    answer: "No. AutoSync comes with a pre-loaded database of 374+ makes, 3,686 models, and 29,515 engines sourced from auto-data.net. Our smart extraction engine automatically detects vehicle compatibility from your existing product titles and descriptions with 80%+ accuracy. You only need to manually map products that can't be auto-detected.",
  },
  {
    question: "How does the UK plate lookup work?",
    answer: "Enterprise plan includes DVLA integration. When a customer enters their UK registration number on your storefront, AutoSync queries the DVLA Vehicle Enquiry Service and MOT History API in real-time. The customer instantly sees their vehicle details (make, model, year, colour, fuel type), MOT status, tax status, and compatible parts from your store.",
  },
  {
    question: "Will the widgets work with my Shopify theme?",
    answer: "Yes. All 7 widgets are Shopify Theme App Extension blocks that work with any Online Store 2.0 theme. They're installed by dragging and dropping in the Shopify theme editor — no code changes required. The CSS is hardened with theme-independent styling (px units, !important on visual properties) to look consistent on any theme.",
  },
  {
    question: "How is AutoSync different from Convermax?",
    answer: "Convermax starts at $250/month with complex setup requiring their support team. AutoSync offers more features — including plate lookup, VIN decode, smart collections, auto-extraction, and 7 widgets — starting completely free with self-service setup in minutes. We're 70-90% cheaper with more capabilities.",
  },
  {
    question: "Can I import products from supplier feeds?",
    answer: "Yes. AutoSync supports CSV upload (with auto-delimiter detection), XML feeds, JSON APIs, REST API connections with authentication, and FTP/SFTP servers with scheduled auto-imports. Smart column mapping auto-detects fields and remembers your mappings for future imports.",
  },
  {
    question: "What happens if I exceed my plan limits?",
    answer: "You'll be notified before reaching limits. You can upgrade anytime with no data loss. Your data is never deleted when you hit limits — you just can't add more products or fitments until you upgrade. Downgrading also preserves all your data.",
  },
  {
    question: "Is there a free trial?",
    answer: "The Free plan lets you try AutoSync with 50 products at no cost, forever — no credit card required. All paid plans include a 14-day free trial so you can test the full feature set before committing.",
  },
];

// ═══════════════════════════════════════
// 10. CAR BRAND LOGOS
// ═══════════════════════════════════════

export const CAR_BRANDS = [
  { name: "BMW", logo: "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/bmw.png" },
  { name: "Audi", logo: "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/audi.png" },
  { name: "Mercedes-Benz", logo: "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/mercedes-benz.png" },
  { name: "Volkswagen", logo: "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/volkswagen.png" },
  { name: "Toyota", logo: "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/toyota.png" },
  { name: "Ford", logo: "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/ford.png" },
  { name: "Porsche", logo: "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/porsche.png" },
  { name: "Honda", logo: "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/honda.png" },
  { name: "Chevrolet", logo: "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/chevrolet.png" },
  { name: "Nissan", logo: "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/nissan.png" },
  { name: "Hyundai", logo: "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/hyundai.png" },
  { name: "Kia", logo: "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/kia.png" },
  { name: "Mazda", logo: "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/mazda.png" },
  { name: "Subaru", logo: "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/subaru.png" },
  { name: "Volvo", logo: "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/volvo.png" },
];

// ═══════════════════════════════════════
// 11. NAVIGATION STRUCTURE
// ═══════════════════════════════════════

export const NAVIGATION = {
  mainLinks: [
    { label: "Features", href: "#features" },
    { label: "How It Works", href: "#how-it-works" },
    { label: "Pricing", href: "#pricing" },
    { label: "Compare", href: "#compare" },
    { label: "FAQ", href: "#faq" },
  ],
  ctaButton: { label: "Start Free Trial", href: "#get-started" },
  footerLinks: {
    product: [
      { label: "Features", href: "#features" },
      { label: "Pricing", href: "#pricing" },
      { label: "Compare", href: "#compare" },
      { label: "FAQ", href: "#faq" },
    ],
    company: [
      { label: "About", href: "#" },
      { label: "Blog", href: "#" },
      { label: "Changelog", href: "#" },
    ],
    legal: [
      { label: "Privacy Policy", href: "/legal/privacy" },
      { label: "Terms of Service", href: "/legal/terms" },
      { label: "Contact", href: "mailto:support@autosync.app" },
    ],
  },
};
