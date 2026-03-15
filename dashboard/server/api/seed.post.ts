import type { ArtifactType, PlanNode } from '../../shared/types/task-engine'
import { createServiceClient } from '../utils/supabase'

const ARTIFACTS: Array<{ type: ArtifactType, title: string, description: string, content: string }> = [
  {
    type: 'markdown',
    title: 'March Cupping Notes',
    description: 'Internal tasting notes from our March 8 cupping session across six single-origin lots.',
    content: `# Monument Coffee Co. — Cupping Session
**Date:** March 8, 2026
**Cuppers:** Ava, Marco, Jules
**Method:** SCA protocol, 200°F, 8.25g/150ml, 4-minute steep

---

## 1. Ethiopia Yirgacheffe — Konga Station, Lot 214
- **Process:** Washed
- **Aroma:** Jasmine, lemon zest, raw honey
- **Flavor:** Bright citrus up front that settles into a ripe peach sweetness. Delicate tea-like body with a clean, lingering bergamot finish.
- **Acidity:** High, sparkling
- **Score:** 88.5

## 2. Colombia Huila — Finca La Esperanza
- **Process:** Honey
- **Aroma:** Brown sugar, dried apricot, light cedar
- **Flavor:** Rich caramel and milk chocolate with a subtle stone-fruit acidity. Medium body with a smooth, round mouthfeel. Finishes with a hint of toasted almond.
- **Acidity:** Medium-bright
- **Score:** 86.0

## 3. Guatemala Antigua — Finca El Volcán
- **Process:** Washed
- **Aroma:** Dark chocolate, walnut, pipe tobacco
- **Flavor:** Deep cocoa and roasted hazelnut wrapped in a full, syrupy body. Low acidity keeps it grounded. Long finish with bittersweet chocolate and a touch of dried fig.
- **Acidity:** Low-medium
- **Score:** 85.5

## 4. Kenya Nyeri — Othaya AB
- **Process:** Washed
- **Aroma:** Blackcurrant, tomato leaf, grapefruit
- **Flavor:** Explosive fruit — blackcurrant jam and blood orange. Juicy, almost wine-like body. Acidity is intense but structured. Finish is long, tart, with a savory edge.
- **Acidity:** Very high
- **Score:** 89.0

## 5. Sumatra Mandheling — Takengon, Lot 07
- **Process:** Wet-hulled
- **Aroma:** Cedar, earthy mushroom, dark cocoa
- **Flavor:** Heavy body with earthy, herbal depth. Notes of pipe tobacco, dried leather, and a low sweetness like molasses. Acidity is muted. Finish is long, smoky, contemplative.
- **Acidity:** Low
- **Score:** 84.0

## 6. Costa Rica Tarrazú — Don Cayito Micro-Mill
- **Process:** Natural
- **Aroma:** Strawberry, vanilla, raw sugar cane
- **Flavor:** Ripe strawberry and tropical fruit with a creamy vanilla undertone. Body is medium-full, silky. Fermentation gives it a funky, wine-like edge that some cuppers loved and Marco flagged as polarizing.
- **Acidity:** Medium
- **Score:** 87.5

---

### Session Notes
- The Kenya and Ethiopia are clear standouts for single-origin retail bags.
- Guatemala and Sumatra are strong candidates for the new dark roast blend.
- Marco wants to revisit the Costa Rica in a week — he thinks the funk will mellow with resting.
- Ava flagged the Colombia as the best all-rounder for wholesale espresso.`
  },
  {
    type: 'csv',
    title: 'Q1 2026 Wholesale Orders',
    description: 'All wholesale orders placed by cafe and retail accounts in Q1 2026.',
    content: `account,blend,quantity_lbs,unit_price,total,order_date,region
Copper Lane Coffee,Basecamp Blend,120,14.50,1740.00,2026-01-07,Northeast
Daybreak Cafe,Single Origin Ethiopia,40,18.00,720.00,2026-01-09,Northeast
The Roasted Bean,Summit Dark,80,13.00,1040.00,2026-01-12,Southeast
Moraine Espresso Bar,Basecamp Blend,200,14.50,2900.00,2026-01-15,West
Copper Lane Coffee,Single Origin Colombia,60,16.50,990.00,2026-01-20,Northeast
Tidal Coffee Co,Basecamp Blend,150,14.50,2175.00,2026-01-22,Southeast
Daybreak Cafe,Ridgeline Light,30,15.00,450.00,2026-01-28,Northeast
Park & Pine,Summit Dark,100,13.00,1300.00,2026-02-02,West
Moraine Espresso Bar,Single Origin Kenya,50,19.00,950.00,2026-02-05,West
The Roasted Bean,Basecamp Blend,90,14.50,1305.00,2026-02-10,Southeast
Copper Lane Coffee,Basecamp Blend,130,14.50,1885.00,2026-02-14,Northeast
Tidal Coffee Co,Ridgeline Light,80,15.00,1200.00,2026-02-18,Southeast
Daybreak Cafe,Single Origin Ethiopia,60,18.00,1080.00,2026-02-22,Northeast
Moraine Espresso Bar,Basecamp Blend,220,14.50,3190.00,2026-02-26,West
Park & Pine,Basecamp Blend,70,14.50,1015.00,2026-03-01,West
Copper Lane Coffee,Summit Dark,40,13.00,520.00,2026-03-04,Northeast
The Roasted Bean,Ridgeline Light,60,15.00,900.00,2026-03-07,Southeast
Tidal Coffee Co,Summit Dark,110,13.00,1430.00,2026-03-10,Southeast
Moraine Espresso Bar,Single Origin Colombia,80,16.50,1320.00,2026-03-12,West
Daybreak Cafe,Basecamp Blend,100,14.50,1450.00,2026-03-14,Northeast`
  },
  {
    type: 'json',
    title: 'Current Roast Profiles',
    description: 'Production roast profiles for all active Monument Coffee blends and single origins.',
    content: JSON.stringify({
      profiles: [
        {
          name: 'Basecamp Blend',
          components: ['Colombia Huila 40%', 'Guatemala Antigua 35%', 'Ethiopia Yirgacheffe 25%'],
          roast_level: 'Medium',
          charge_temp_f: 385,
          turning_point_f: 165,
          first_crack_f: 398,
          drop_temp_f: 415,
          development_time_pct: 18.5,
          total_roast_time_min: 11.5,
          notes: 'The workhorse. Approachable chocolate-and-caramel cup that plays well as drip or espresso. Push development a hair longer for wholesale espresso accounts.'
        },
        {
          name: 'Summit Dark',
          components: ['Guatemala Antigua 50%', 'Sumatra Mandheling 50%'],
          roast_level: 'Dark',
          charge_temp_f: 400,
          turning_point_f: 170,
          first_crack_f: 400,
          drop_temp_f: 440,
          development_time_pct: 24.0,
          total_roast_time_min: 13.0,
          notes: 'Full body, low acidity, smoky finish. Designed for customers who want bold without burnt. Pull before second crack — we are not making charcoal.'
        },
        {
          name: 'Ridgeline Light',
          components: ['Ethiopia Yirgacheffe 60%', 'Costa Rica Tarrazú 40%'],
          roast_level: 'Light',
          charge_temp_f: 370,
          turning_point_f: 155,
          first_crack_f: 395,
          drop_temp_f: 405,
          development_time_pct: 14.0,
          total_roast_time_min: 10.5,
          notes: 'Bright, floral, fruity. This one lives or dies on the Ethiopia lot quality. If the Yirg scores below 87, swap in the Kenya for more structure.'
        },
        {
          name: 'Single Origin Ethiopia — Konga Washed',
          components: ['Ethiopia Yirgacheffe Konga Lot 214 100%'],
          roast_level: 'Light-Medium',
          charge_temp_f: 375,
          turning_point_f: 158,
          first_crack_f: 396,
          drop_temp_f: 410,
          development_time_pct: 16.0,
          total_roast_time_min: 11.0,
          notes: 'Showcase roast. Keep it light enough to preserve the jasmine and citrus. This lot has been our best seller on the retail shelf three months running.'
        }
      ],
      roaster: 'Loring S35 Kestrel',
      last_calibration: '2026-02-20',
      gas_pressure_psi: 4.5
    }, null, 2)
  },
  {
    type: 'markdown',
    title: 'Tasting Room Feedback — March',
    description: 'Customer feedback cards and online survey responses from our tasting room in March 2026.',
    content: `# Tasting Room Feedback — March 2026

Collected from comment cards (in-store) and the post-visit survey link.

---

**"The Ethiopia pour-over was incredible. Genuinely tasted like jasmine tea with lemon. I bought two bags on the spot."**
— Sarah M., visited March 2

**"I come here every Saturday. The Basecamp Blend is the most consistent coffee I've had anywhere. Never lets me down."**
— David R., regular

**"Loved the space and the staff were really knowledgeable. One suggestion: it would be great to have a decaf option for the single origins. I can't do caffeine after noon but still want the good stuff."**
— Priya K., visited March 5

**"The Summit Dark is too dark for me personally but my husband couldn't stop talking about it. He said it reminded him of coffee in Istanbul. We bought a bag for him."**
— Lena T., visited March 8

**"Would love to see you do a subscription box. Like 3 different single origins each month with tasting notes. I'd sign up immediately."**
— Jason W., online survey

**"Tried the Ridgeline Light as espresso and it was SOUR. I think it really only works as filter. Maybe a note on the menu about that?"**
— Alex C., visited March 10

**"Your Costa Rica natural was wild. I've never tasted strawberry in coffee before. Felt like a wine tasting. Is this what specialty coffee is? I'm converted."**
— Michelle O., visited March 12

**"The cold brew was fine but nothing special. Maybe try the Kenya for cold brew? That blackcurrant thing it does might be amazing cold."**
— Tom H., visited March 14

**"I brought my mom here thinking she'd hate it (she's a Folgers person). She tried the Colombia and said 'oh, this is actually smooth.' Small victory."**
— Nina G., visited March 15

**"Prices are a bit steep for a regular habit, but I get it. The quality is there. Any plans for a loyalty card or punch card situation?"**
— Ryan B., online survey

**"The cupping event last weekend was so fun. I learned more about coffee in an hour than in my whole life. Please do these monthly."**
— Amara J., visited March 9

**"I wish you had oat milk. Almond milk in a pour-over is a crime and I will die on this hill."**
— Kai L., visited March 11

---

**Summary stats:**
- 47 total responses this month (31 cards, 16 online)
- Net promoter score: 72
- Top mentioned product: Ethiopia Yirgacheffe (14 mentions)
- Top request: Decaf single origin (6 mentions)
- Second request: Subscription service (5 mentions)`
  },
  {
    type: 'csv',
    title: 'Green Bean Inventory',
    description: 'Current unroasted green bean stock levels as of March 14, 2026.',
    content: `origin,lot,process,weight_lbs,cost_per_lb,arrival_date,grade,notes
Ethiopia Yirgacheffe,Konga 214,Washed,185,6.40,2025-12-10,SCA 88.5,Star lot — reorder before we hit 50 lbs
Colombia Huila,La Esperanza,Honey,320,5.20,2026-01-15,SCA 86.0,Solid Basecamp component
Guatemala Antigua,El Volcán,Washed,140,4.80,2025-11-20,SCA 85.5,Getting low — next crop arrives April
Kenya Nyeri,Othaya AB,Washed,95,7.10,2026-02-01,SCA 89.0,Expensive but worth it for retail bags
Sumatra Mandheling,Takengon 07,Wet-hulled,210,4.50,2025-10-28,SCA 84.0,Plenty of stock for Summit Dark
Costa Rica Tarrazú,Don Cayito,Natural,42,6.80,2026-01-05,SCA 87.5,Running low — decide if we reorder or swap
Brazil Santos,Fazenda Boa Vista,Natural,400,3.20,2025-09-15,SCA 82.0,Filler for price-sensitive wholesale blends
Peru Cajamarca,Coop Sol y Café,Washed,75,4.90,2026-02-20,SCA 83.5,Testing for a new blend — not in production yet
Rwanda Nyamasheke,Buf Station,Washed,30,7.50,2026-03-01,SCA 88.0,Almost gone — phenomenal cup but tiny lot
Honduras Copán,Finca Santa Rosa,Washed,260,4.60,2025-12-05,SCA 84.5,Reliable backup for Guatemala component
Mexico Chiapas,Coop Triunfo Verde,Washed,180,4.30,2026-01-28,SCA 83.0,Organic certified — good for the organic blend SKU
Papua New Guinea,Sigri Estate,Washed,65,5.80,2025-11-15,SCA 85.0,Unique earthy-sweet profile — use in limited release`
  },
  {
    type: 'csv',
    title: 'Staff Schedule — March 2026',
    description: 'Weekly shift schedule for all Monument Coffee staff covering tasting room, roasting, and operations.',
    content: `employee,role,monday,tuesday,wednesday,thursday,friday,saturday,sunday,hours_per_week
Ava Moreno,Head Roaster,6a-2p,6a-2p,OFF,6a-2p,6a-2p,7a-12p,OFF,37
Marco DeLuca,Roaster / QC Lead,OFF,6a-2p,6a-2p,6a-2p,OFF,7a-12p,7a-12p,37
Jules Achebe,Tasting Room Lead,8a-4p,8a-4p,8a-4p,OFF,8a-4p,9a-5p,OFF,40
Sam Nguyen,Barista,OFF,10a-6p,10a-6p,10a-6p,10a-6p,9a-5p,OFF,40
Dani Ortiz,Barista,10a-6p,OFF,OFF,10a-6p,10a-6p,9a-5p,10a-4p,38
Riley Chen,Operations & Shipping,7a-3p,7a-3p,7a-3p,7a-3p,7a-3p,OFF,OFF,40
Kai Washington,Part-time Barista,OFF,OFF,4p-8p,4p-8p,4p-8p,OFF,10a-4p,18
Noor Patel,Weekend Barista,OFF,OFF,OFF,OFF,OFF,8a-4p,8a-4p,16
Liam Torres,Delivery Driver,8a-1p,8a-1p,OFF,8a-1p,8a-1p,OFF,OFF,20
Elena Vasquez,Owner / GM,varies,varies,varies,varies,varies,varies,OFF,45`
  },
  {
    type: 'json',
    title: 'Competitor Pricing Intel',
    description: 'Pricing data collected from local and online specialty roasters competing in our market.',
    content: JSON.stringify({
      collected_date: '2026-03-10',
      market: 'Portland metro + online DTC',
      competitors: [
        {
          name: 'Stumptown Coffee',
          type: 'regional_roaster',
          products: [
            { name: 'Hair Bender (blend)', size_oz: 12, price: 17.00, per_oz: 1.42 },
            { name: 'Holler Mountain (blend)', size_oz: 12, price: 16.00, per_oz: 1.33 },
            { name: 'Ethiopia Mordecofe (SO)', size_oz: 12, price: 19.00, per_oz: 1.58 }
          ]
        },
        {
          name: 'Coava Coffee',
          type: 'local_roaster',
          products: [
            { name: 'Kilenso (SO Ethiopia)', size_oz: 12, price: 21.00, per_oz: 1.75 },
            { name: 'Mezcla (blend)', size_oz: 12, price: 17.50, per_oz: 1.46 }
          ]
        },
        {
          name: 'Heart Coffee',
          type: 'local_roaster',
          products: [
            { name: 'Stereo Blend', size_oz: 10, price: 18.00, per_oz: 1.80 },
            { name: 'Kenya Kamwangi (SO)', size_oz: 10, price: 24.00, per_oz: 2.40 }
          ]
        },
        {
          name: 'Onyx Coffee Lab',
          type: 'online_dtc',
          products: [
            { name: 'Southern Weather (blend)', size_oz: 10, price: 18.50, per_oz: 1.85 },
            { name: 'Geometry (blend)', size_oz: 10, price: 17.00, per_oz: 1.70 },
            { name: 'Ethiopia Buku (SO)', size_oz: 10, price: 22.00, per_oz: 2.20 }
          ]
        },
        {
          name: 'Verve Coffee',
          type: 'online_dtc',
          products: [
            { name: 'Streetlevel (blend)', size_oz: 12, price: 19.00, per_oz: 1.58 },
            { name: 'Buena Vista (blend)', size_oz: 12, price: 18.00, per_oz: 1.50 },
            { name: 'Kenya Gakuyuini (SO)', size_oz: 10, price: 25.00, per_oz: 2.50 }
          ]
        }
      ],
      our_pricing: {
        retail_12oz: {
          'Basecamp Blend': 15.50,
          'Summit Dark': 15.50,
          'Ridgeline Light': 16.50,
          'SO Ethiopia Konga': 19.00,
          'SO Kenya Othaya': 20.00,
          'SO Colombia Huila': 17.00,
          'SO Costa Rica Tarrazú': 18.50
        },
        wholesale_per_lb: {
          'Basecamp Blend': 14.50,
          'Summit Dark': 13.00,
          'Ridgeline Light': 15.00,
          'Single Origins': '16.50-19.00'
        }
      },
      notes: 'We are priced at the lower end of specialty for blends and mid-range for single origins. There may be room to increase SO pricing by $1-2 without losing volume, especially on the Kenya and Ethiopia which score well above their price point.'
    }, null, 2)
  },
  {
    type: 'csv',
    title: 'Monthly P&L — February 2026',
    description: 'Profit and loss statement for Monument Coffee Co. for February 2026.',
    content: `category,subcategory,amount,type
Revenue,Retail - Tasting Room,18420.00,income
Revenue,Retail - Online,6835.00,income
Revenue,Wholesale - Blends,14210.00,income
Revenue,Wholesale - Single Origins,4890.00,income
Revenue,Events & Cuppings,720.00,income
Revenue,Merchandise,485.00,income
COGS,Green Coffee Beans,-12640.00,expense
COGS,Packaging & Labels,-2180.00,expense
COGS,Shipping & Freight,-1890.00,expense
Operating,Rent & Utilities,-4200.00,expense
Operating,Payroll - Roasting,-8400.00,expense
Operating,Payroll - Tasting Room,-7200.00,expense
Operating,Payroll - Operations,-3800.00,expense
Operating,Insurance,-650.00,expense
Operating,Equipment Maintenance,-380.00,expense
Marketing,Social Media Ads,-1200.00,expense
Marketing,Print & Local Sponsorship,-450.00,expense
Marketing,Website & Hosting,-85.00,expense
Admin,Accounting & Legal,-600.00,expense
Admin,Software & Subscriptions,-340.00,expense
Admin,Miscellaneous,-280.00,expense`
  },
  {
    type: 'markdown',
    title: 'Equipment Maintenance Log',
    description: 'Maintenance history and upcoming service schedule for roasting and cafe equipment.',
    content: `# Equipment Maintenance Log
**Last updated:** March 12, 2026

---

## Loring S35 Kestrel (Primary Roaster)
| Date | Service | Technician | Notes |
|------|---------|------------|-------|
| 2025-09-15 | Annual full service | Loring certified tech | Replaced afterburner ignitor, cleaned catalytic converter, calibrated thermocouples |
| 2025-12-10 | Quarterly check | Ava (in-house) | Cleaned chaff collector, checked drum bearings, gas pressure OK at 4.5 PSI |
| 2026-02-20 | Thermocouple recalibration | Loring certified tech | Bean probe was reading 3F high, corrected. Exhaust probe fine. |
| **2026-03-15** | **Quarterly check DUE** | Ava | Chaff collector clean, drum bearing inspection, gas pressure check |
| **2026-06-15** | **Semi-annual service DUE** | Loring tech | Full inspection, afterburner efficiency test |

## Mahlkonig EK43S (Grinder - Tasting Room)
| Date | Service | Notes |
|------|---------|-------|
| 2025-11-01 | Burr replacement | Installed new Turkish Steel burrs, seasoned with 5 lbs Brazil |
| 2026-01-15 | Alignment check | Marker test passed, no adjustment needed |
| **2026-05-01** | **Burr replacement DUE** | Est. 800 lbs throughput since last change |

## La Marzocco Linea PB (Espresso Machine)
| Date | Service | Notes |
|------|---------|-------|
| 2025-10-20 | Annual service | New group gaskets, shower screens replaced, boiler descaled |
| 2026-01-08 | Pressure adjustment | Brew pressure dropped to 8.2 bar, adjusted back to 9.0 |
| 2026-02-28 | Group head clean | Deep clean with Cafiza, backflushed all 3 groups |
| **2026-04-20** | **Semi-annual service DUE** | Group gaskets, water softener check |

## Bunn ICB Twin (Batch Brewer)
| Date | Service | Notes |
|------|---------|-------|
| 2025-12-01 | Delimed | Standard deliming procedure |
| 2026-03-01 | Delimed | Spray head was partially clogged, cleared |
| **2026-06-01** | **Deliming DUE** | |

## Ditting 807 Lab Sweet (Sample Roast Grinder)
| Date | Service | Notes |
|------|---------|-------|
| 2025-08-15 | Burr replacement | OEM burrs installed |
| **2026-08-15** | **Burr replacement DUE** | Annual cycle |

---

### Maintenance Budget
- FY2026 budget: $8,400
- Spent YTD: $2,960
- Remaining: $5,440
- Next major expense: Loring semi-annual (~$1,800)`
  },
  {
    type: 'markdown',
    title: 'Social Media Calendar — March 2026',
    description: 'Planned and published social media posts for Monument Coffee across Instagram and newsletter.',
    content: `# Social Media Calendar — March 2026

## Week 1 (Mar 1-7)
| Day | Platform | Post | Status |
|-----|----------|------|--------|
| Mon 3/1 | Instagram | Photo: New Rwanda lot arrival. Caption about small-lot sourcing and the Buf Station story. | Published |
| Wed 3/3 | Instagram | Reel: Ava roasting the Ethiopia Konga. 30-sec time lapse with cupping score reveal. | Published |
| Fri 3/5 | Newsletter | "What's Brewing" weekly — Rwanda spotlight, upcoming cupping event, staff pick (Jules: Kenya pour-over) | Published |

## Week 2 (Mar 8-14)
| Day | Platform | Post | Status |
|-----|----------|------|--------|
| Mon 3/8 | Instagram | Carousel: Cupping session highlights. 4 slides with flavor wheels for top-scoring lots. | Published |
| Wed 3/10 | Instagram | Story: Behind the scenes of a wholesale delivery to Moraine Espresso Bar. | Published |
| Fri 3/12 | Newsletter | "What's Brewing" weekly — Cupping recap, cold brew Kenya experiment teaser, March tasting room hours | Published |

## Week 3 (Mar 15-21)
| Day | Platform | Post | Status |
|-----|----------|------|--------|
| Mon 3/15 | Instagram | Photo: Costa Rica natural on the cupping table. Caption about the strawberry note and why naturals are wild. | Drafted |
| Wed 3/17 | Instagram | Reel: "How we taste coffee" — Jules walking through the SCA cupping protocol. Educational, casual. | Idea |
| Fri 3/19 | Newsletter | "What's Brewing" weekly — Costa Rica deep dive, subscriber discount code, Q&A with Marco on roast profiles | Idea |

## Week 4 (Mar 22-28)
| Day | Platform | Post | Status |
|-----|----------|------|--------|
| Mon 3/22 | Instagram | Carousel: "Meet the team" — short bios and favorite coffees from each staff member. | Idea |
| Wed 3/24 | Instagram | Photo: Spring morning in the tasting room. Lifestyle shot, warm light, people enjoying coffee. | Idea |
| Fri 3/26 | Newsletter | "What's Brewing" weekly — April preview, new blend teaser, reader spotlight | Idea |

---

### Content Performance (Feb)
- Avg. Instagram reach: 2,340/post (up 18% from Jan)
- Newsletter open rate: 44% (industry avg ~21%)
- Top post: Ethiopia roasting reel (8,200 reach, 312 saves)
- Subscriber growth: +89 new (total: 2,410)`
  },
  {
    type: 'json',
    title: 'Subscription Box Survey Results',
    description: 'Results from the online survey sent to tasting room visitors about a potential coffee subscription offering.',
    content: JSON.stringify({
      survey_period: '2026-02-15 to 2026-03-10',
      total_responses: 127,
      questions: [
        {
          question: 'Would you subscribe to a monthly coffee box from Monument?',
          responses: { 'Definitely yes': 58, 'Probably yes': 41, 'Maybe': 19, 'Probably not': 7, 'No': 2 }
        },
        {
          question: 'How many bags per month would you want?',
          responses: { '1 bag (12oz)': 14, '2 bags (12oz each)': 52, '3 bags (12oz each)': 48, '4+ bags': 13 }
        },
        {
          question: 'What price range feels right per month?',
          responses: { 'Under $30': 18, '$30-45': 54, '$45-60': 39, '$60-80': 14, 'Over $80': 2 }
        },
        {
          question: 'What would make you most excited about a subscription?',
          responses: {
            'Exclusive/pre-release coffees': 72,
            'Tasting notes and brewing tips': 61,
            'Roaster choice (surprise me)': 58,
            'Choose my own coffees': 44,
            'Discount vs retail price': 41,
            'Free shipping': 89
          },
          allows_multiple: true
        },
        {
          question: 'Which format do you prefer?',
          responses: { 'Whole bean': 94, 'Ground for drip': 22, 'Ground for espresso': 8, 'Choose each time': 3 }
        },
        {
          question: 'How did you hear about Monument Coffee?',
          responses: {
            'Walked by the tasting room': 38,
            'Instagram': 34,
            'Friend recommendation': 29,
            'Google search': 14,
            'Farmers market': 9,
            'Other': 3
          }
        }
      ],
      free_text_highlights: [
        'I would love a "coffee of the month" with a postcard from the farm.',
        'Please do a decaf option for at least one of the bags!',
        'Pairing suggestion with a local bakery item would be a nice touch.',
        'If you did a gift subscription, I would buy it for everyone I know.',
        'Include a small sample of the next month\'s coffee as a teaser.',
        'I want to learn more about processing methods. Include a mini-lesson.',
        'A quarterly "rare lots" box at a higher price point would be incredible.',
        'Flexible skip/pause is important. I travel a lot and hate wasting good coffee.',
        'Would be cool to get a brew recipe card for each coffee, optimized for the specific bag.',
        'Do a collaboration with a local chocolate maker. Coffee + chocolate pairing box.'
      ]
    }, null, 2)
  },
  {
    type: 'markdown',
    title: 'Wholesale Onboarding Checklist',
    description: 'Standard onboarding workflow for new wholesale cafe and retail accounts.',
    content: `# Wholesale Account Onboarding Checklist

**For:** New cafe and retail partners
**Owner:** Riley Chen (Operations & Shipping)
**Last revised:** February 2026

---

## Phase 1: Initial Contact
- [ ] Inquiry received (website form, email, or trade show)
- [ ] Reply within 24 hours with welcome packet PDF
- [ ] Schedule intro call or tasting room visit
- [ ] Collect account info: business name, address, contact, volume estimate

## Phase 2: Tasting & Selection
- [ ] Send sample kit (4 x 4oz bags: Basecamp, Summit, Ridgeline, one SO)
- [ ] Follow up within 1 week for feedback
- [ ] Finalize product selection and order volume
- [ ] Discuss pricing tier based on monthly commitment:
  - **Tier 1:** 50-99 lbs/mo — Standard wholesale pricing
  - **Tier 2:** 100-199 lbs/mo — 5% volume discount
  - **Tier 3:** 200+ lbs/mo — 10% volume discount + priority roast scheduling

## Phase 3: Account Setup
- [ ] Create account in order system
- [ ] Set up NET 30 payment terms (or COD for first 3 orders)
- [ ] Assign delivery route (local) or configure shipping (regional)
- [ ] Send welcome email with order portal login, delivery schedule, and contact info

## Phase 4: First Order
- [ ] Process and roast first order
- [ ] Include "Getting Started" card with brew ratios and storage tips
- [ ] Riley hand-delivers first local order when possible
- [ ] Follow up call 3 days after delivery

## Phase 5: Ongoing
- [ ] Monthly check-in for first 3 months
- [ ] Quarterly review: volume trends, product mix, any issues
- [ ] Invite to seasonal cupping events
- [ ] Annual pricing review

---

### Notes
- Average time from inquiry to first order: 2-3 weeks
- Current active wholesale accounts: 6
- Target by end of Q2 2026: 10 accounts
- Biggest bottleneck: sample kit turnaround (Ava needs 3-day lead time for fresh roast samples)`
  }
]

const SEED_DATA = [
  {
    plan: {
      title: 'Wholesale Sales Analysis',
      description: 'Computes revenue breakdowns by account and product, identifies trends, and outputs a summary report.',
      prompt: 'Analyze wholesale order data. Break down revenue by account and by product. Identify the top accounts by total spend, the fastest-growing product, and any accounts whose order volume dropped over the period. Produce a concise markdown report with the key findings.'
    },
    task: {
      title: 'Q1 2026 Sales Analysis',
      prompt: 'Analyze the Q1 wholesale orders. Break down revenue by account and by blend. Identify the top 3 accounts by total spend, the fastest-growing blend (comparing Jan to Mar), and any accounts whose order volume dropped month over month. Produce a concise markdown report with the key findings.',
      input_artifacts: ['Q1 2026 Wholesale Orders']
    },
    nodes: [
      {
        id: 'analyze_sales',
        type: 'agent_code',
        description: 'Parse the order CSV and compute revenue breakdowns by account, product, and month.',
        per_artifact: false,
        depends_on: [],
        prompt: 'You have wholesale order data in CSV format. Parse it and compute: (1) total revenue and order count by account, ranked by spend; (2) total revenue by product; (3) monthly revenue trend per product to identify which grew fastest; (4) flag any account whose monthly order volume decreased. Output a clean markdown report with the numbers.',
        labels: null, max_length: null, source: null, filter: null,
        condition: null, if_true_node: null, if_false_node: null,
        duration: null, message: null, title: null, format: null, level: null
      },
      {
        id: 'write_report',
        type: 'emit',
        description: 'Save the sales analysis as a markdown report.',
        per_artifact: false,
        depends_on: ['analyze_sales'],
        title: 'Sales Analysis Report — {{date}}',
        format: 'markdown',
        prompt: null, labels: null, max_length: null, source: null,
        filter: null, condition: null, if_true_node: null,
        if_false_node: null, duration: null, message: null, level: null
      }
    ]
  },
  {
    plan: {
      title: 'Cupping Notes to Website Copy',
      description: 'Rewrites internal cupping notes as customer-facing tasting descriptions and sends for human review before publishing.',
      prompt: 'Transform internal cupping notes into engaging, customer-facing tasting descriptions for the website. Each coffee should get a short, evocative paragraph that communicates flavor without jargon. Keep the personality of a small roaster who genuinely cares. Send for review before finalizing.'
    },
    task: {
      title: 'Polish March Cupping Notes',
      prompt: 'Take our March 8 cupping session notes and transform them into engaging website tasting descriptions. Cover all six single-origin lots. Keep the tone warm and accessible. Send for review before finalizing.',
      input_artifacts: ['March Cupping Notes']
    },
    nodes: [
      {
        id: 'polish_notes',
        type: 'llm_transform',
        description: 'Rewrite the technical cupping notes into warm, customer-facing tasting descriptions.',
        per_artifact: true,
        depends_on: [],
        prompt: 'You are writing for a specialty coffee roaster\'s website. Transform these internal cupping notes into customer-facing tasting descriptions. For each coffee: write a 2-3 sentence description that captures the key flavors, body, and character. Use vivid but accessible language. Avoid SCA scores and technical terms like "processing method." The tone should feel like a knowledgeable friend recommending a coffee, not a textbook.',
        labels: null, max_length: null, source: null, filter: null,
        condition: null, if_true_node: null, if_false_node: null,
        duration: null, message: null, title: null, format: null, level: null
      },
      {
        id: 'review_copy',
        type: 'review',
        description: 'Human review of the polished tasting descriptions before they go live.',
        per_artifact: false,
        depends_on: ['polish_notes'],
        message: 'Review the polished tasting descriptions. Check that the flavor notes are accurate and the tone matches the brand voice.',
        prompt: null, labels: null, max_length: null, source: null,
        filter: null, condition: null, if_true_node: null,
        if_false_node: null, duration: null, title: null, format: null, level: null
      },
      {
        id: 'publish',
        type: 'emit',
        description: 'Save the approved tasting descriptions.',
        per_artifact: false,
        depends_on: ['review_copy'],
        title: 'Website Tasting Descriptions — {{date}}',
        format: 'markdown',
        prompt: null, labels: null, max_length: null, source: null,
        filter: null, condition: null, if_true_node: null,
        if_false_node: null, duration: null, message: null, level: null
      }
    ]
  },
  {
    plan: {
      title: 'Inventory Low Stock Check',
      description: 'Scans inventory data for items below a threshold, flags critical levels, and generates a prioritized reorder recommendation.',
      prompt: 'Check inventory for any items with low remaining stock. Identify items below a critical threshold, note current levels and costs, and generate a prioritized reorder recommendation considering which items are used in active production.'
    },
    task: {
      title: 'Green Bean Low Stock Alert',
      prompt: 'Check the green bean inventory for any origins with less than 50 lbs remaining. For each low-stock origin, note the current weight, cost per lb, and when it arrived. Generate a prioritized reorder recommendation considering which origins are used in our active blends.',
      trigger_type: 'scheduled' as const,
      schedule_config: { cron: '0 7 * * 1', description: 'Every Monday at 7am' },
      input_artifacts: ['Green Bean Inventory']
    },
    nodes: [
      {
        id: 'check_stock',
        type: 'agent_code',
        description: 'Parse inventory data and identify items below the low-stock threshold.',
        per_artifact: false,
        depends_on: [],
        prompt: 'Parse the inventory CSV. Find all items where stock is below the low threshold. For each, output the item name, lot, current quantity, cost, arrival date, and grade. Also flag anything approaching the threshold as "watch list." Format the output as a structured markdown table.',
        labels: null, max_length: null, source: null, filter: null,
        condition: null, if_true_node: null, if_false_node: null,
        duration: null, message: null, title: null, format: null, level: null
      },
      {
        id: 'reorder_summary',
        type: 'llm_summarize',
        description: 'Summarize the low-stock findings into an actionable reorder recommendation.',
        per_artifact: false,
        depends_on: ['check_stock'],
        prompt: 'Given the low-stock inventory analysis, write a concise reorder recommendation. Prioritize by: (1) items that are critically low, (2) items used in active production, (3) high-grade items worth restocking. For each, suggest a reorder quantity based on typical usage. Keep it brief and actionable.',
        max_length: 500,
        labels: null, source: null, filter: null, condition: null,
        if_true_node: null, if_false_node: null, duration: null,
        message: null, title: null, format: null, level: null
      },
      {
        id: 'output',
        type: 'emit',
        description: 'Save the reorder recommendation.',
        per_artifact: false,
        depends_on: ['reorder_summary'],
        title: 'Low Stock Reorder List — {{date}}',
        format: 'markdown',
        prompt: null, labels: null, max_length: null, source: null,
        filter: null, condition: null, if_true_node: null,
        if_false_node: null, duration: null, message: null, level: null
      }
    ]
  },
  {
    plan: {
      title: 'Customer Feedback Digest',
      description: 'Classifies customer feedback by sentiment and type, then drafts a team-facing digest with highlights, improvement areas, and product ideas.',
      prompt: 'Read through customer feedback. Classify each item as positive, constructive, or a product request. Then draft a short digest that highlights what customers love, what to consider changing, and any product ideas worth exploring.'
    },
    task: {
      title: 'March Tasting Room Feedback',
      prompt: 'Read through the tasting room feedback collected in March. Classify each piece as positive, constructive, or a product request. Then draft a short digest for the team highlighting what customers loved, what we should consider changing, and any product ideas worth exploring.',
      input_artifacts: ['Tasting Room Feedback — March']
    },
    nodes: [
      {
        id: 'classify_feedback',
        type: 'llm_classify',
        description: 'Classify each feedback item by sentiment and type.',
        per_artifact: true,
        depends_on: [],
        prompt: 'Read each piece of customer feedback and classify it. A single response may contain multiple categories. Output the classification and a one-line summary of the key point.',
        labels: ['positive', 'constructive', 'product_request'],
        max_length: null, source: null, filter: null, condition: null,
        if_true_node: null, if_false_node: null, duration: null,
        message: null, title: null, format: null, level: null
      },
      {
        id: 'draft_digest',
        type: 'agent_transform',
        description: 'Draft a team-facing digest summarizing the classified feedback.',
        per_artifact: false,
        depends_on: ['classify_feedback'],
        prompt: 'You have classified customer feedback. Draft a short digest (300-500 words) for the team. Structure it as: (1) What customers love; (2) What to improve; (3) Product ideas worth exploring. Use specific quotes where they add color. Keep the tone practical and optimistic.',
        labels: null, max_length: null, source: null, filter: null,
        condition: null, if_true_node: null, if_false_node: null,
        duration: null, message: null, title: null, format: null, level: null
      },
      {
        id: 'output',
        type: 'emit',
        description: 'Save the feedback digest.',
        per_artifact: false,
        depends_on: ['draft_digest'],
        title: 'Customer Feedback Digest — {{date}}',
        format: 'markdown',
        prompt: null, labels: null, max_length: null, source: null,
        filter: null, condition: null, if_true_node: null,
        if_false_node: null, duration: null, message: null, level: null
      }
    ]
  },
  {
    plan: {
      title: 'Competitor Pricing Analysis',
      description: 'Compares our retail and wholesale pricing against competitors, flags where we are under- or over-priced, and recommends adjustments with projected revenue impact.',
      prompt: 'Analyze our pricing relative to competitors. Compare per-ounce pricing for blends and single origins. Flag any products where we are significantly cheaper or more expensive than the market average. Recommend pricing adjustments and estimate the revenue impact. If any product is priced more than 15% below market, flag it for immediate review.'
    },
    task: {
      title: 'Pricing Gap Analysis vs. Market',
      prompt: 'Compare our retail pricing against the competitor pricing intel we collected. Calculate per-ounce averages by category (blends vs single origins). Flag products where we are priced more than 15% below or above the market average. Recommend specific price changes with estimated monthly revenue impact based on our Q1 sales volume.',
      input_artifacts: ['Competitor Pricing Intel', 'Q1 2026 Wholesale Orders']
    },
    nodes: [
      {
        id: 'compute_comparison',
        type: 'agent_code',
        description: 'Calculate per-ounce averages and compare our pricing vs. market.',
        per_artifact: false,
        depends_on: [],
        prompt: 'You have competitor pricing data (JSON) and our wholesale order data (CSV). Calculate the market average per-ounce price for blends and single origins separately. Compare each of our products to the market average. Flag any product priced more than 15% below or above the average. For flagged products, estimate the monthly revenue impact of adjusting to market average based on Q1 volume data.',
        labels: null, max_length: null, source: null, filter: null,
        condition: null, if_true_node: null, if_false_node: null,
        duration: null, message: null, title: null, format: null, level: null
      },
      {
        id: 'check_underpriced',
        type: 'branch',
        description: 'Check if any products are significantly underpriced and need urgent review.',
        per_artifact: false,
        depends_on: ['compute_comparison'],
        condition: 'Any product is priced more than 15% below market average',
        if_true_node: 'notify_team',
        if_false_node: 'write_report',
        prompt: null, labels: null, max_length: null, source: null,
        filter: null, duration: null, message: null, title: null,
        format: null, level: null
      },
      {
        id: 'notify_team',
        type: 'notify',
        description: 'Alert the team that we have significantly underpriced products.',
        per_artifact: false,
        depends_on: ['check_underpriced'],
        message: 'Pricing alert: One or more products are priced over 15% below market average. Review the attached pricing analysis for recommended adjustments.',
        level: 'warning',
        prompt: null, labels: null, max_length: null, source: null,
        filter: null, condition: null, if_true_node: null,
        if_false_node: null, duration: null, title: null, format: null
      },
      {
        id: 'write_report',
        type: 'emit',
        description: 'Save the pricing comparison report.',
        per_artifact: false,
        depends_on: ['check_underpriced', 'notify_team'],
        title: 'Pricing Analysis — {{date}}',
        format: 'markdown',
        prompt: null, labels: null, max_length: null, source: null,
        filter: null, condition: null, if_true_node: null,
        if_false_node: null, duration: null, message: null, level: null
      }
    ]
  },
  {
    plan: {
      title: 'Monthly Financial Report',
      description: 'Extracts key metrics from the P&L, computes margins and expense ratios, and produces an executive summary with month-over-month context.',
      prompt: 'Take the monthly P&L data. Extract total revenue, total COGS, gross margin, operating expenses by category, and net income. Compute gross margin percentage and key expense ratios. Draft an executive summary suitable for the owner with highlights, concerns, and recommendations.'
    },
    task: {
      title: 'February 2026 Financial Review',
      prompt: 'Analyze the February 2026 P&L statement. Calculate total revenue, gross margin, operating profit, and net income. Identify the largest expense categories and compute their percentage of revenue. Compare revenue mix (retail vs wholesale vs other). Draft a brief owner-facing summary with the key numbers and any concerns.',
      trigger_type: 'scheduled' as const,
      schedule_config: { cron: '0 9 5 * *', description: '5th of every month at 9am' },
      input_artifacts: ['Monthly P&L — February 2026']
    },
    nodes: [
      {
        id: 'extract_metrics',
        type: 'llm_extract',
        description: 'Extract key financial metrics from the P&L CSV.',
        per_artifact: false,
        depends_on: [],
        prompt: 'From this P&L data, extract: total revenue (by category), total COGS, gross profit, total operating expenses (by category), total marketing expenses, total admin expenses, and net income. Return as structured data.',
        labels: null, max_length: null, source: null, filter: null,
        condition: null, if_true_node: null, if_false_node: null,
        duration: null, message: null, title: null, format: null, level: null
      },
      {
        id: 'compute_ratios',
        type: 'agent_code',
        description: 'Calculate margin percentages, expense ratios, and revenue mix.',
        per_artifact: false,
        depends_on: ['extract_metrics'],
        prompt: 'Given the extracted financial metrics, compute: (1) gross margin percentage, (2) operating margin percentage, (3) net margin percentage, (4) each expense category as a percentage of total revenue, (5) revenue mix breakdown (retail, wholesale, other as percentages). Format as a clean markdown table.',
        labels: null, max_length: null, source: null, filter: null,
        condition: null, if_true_node: null, if_false_node: null,
        duration: null, message: null, title: null, format: null, level: null
      },
      {
        id: 'check_margin',
        type: 'branch',
        description: 'Check if gross margin is healthy or needs attention.',
        per_artifact: false,
        depends_on: ['compute_ratios'],
        condition: 'Gross margin is below 55%',
        if_true_node: 'margin_warning',
        if_false_node: 'draft_summary',
        prompt: null, labels: null, max_length: null, source: null,
        filter: null, duration: null, message: null, title: null,
        format: null, level: null
      },
      {
        id: 'margin_warning',
        type: 'notify',
        description: 'Alert that gross margin is below target.',
        per_artifact: false,
        depends_on: ['check_margin'],
        message: 'Margin alert: Gross margin has dropped below the 55% target. Review COGS and pricing.',
        level: 'warning',
        prompt: null, labels: null, max_length: null, source: null,
        filter: null, condition: null, if_true_node: null,
        if_false_node: null, duration: null, title: null, format: null
      },
      {
        id: 'draft_summary',
        type: 'agent_transform',
        description: 'Write the owner-facing executive summary.',
        per_artifact: false,
        depends_on: ['check_margin', 'margin_warning'],
        prompt: 'You are writing a monthly financial summary for the owner of a small specialty coffee roaster. Given the computed metrics, write a concise executive summary (200-400 words). Include: top-line revenue, margin health, biggest expense categories, revenue mix observations, and 2-3 actionable recommendations. Keep the tone direct and practical.',
        labels: null, max_length: null, source: null, filter: null,
        condition: null, if_true_node: null, if_false_node: null,
        duration: null, message: null, title: null, format: null, level: null
      },
      {
        id: 'output',
        type: 'emit',
        description: 'Save the financial review.',
        per_artifact: false,
        depends_on: ['draft_summary'],
        title: 'Financial Review — Feb 2026',
        format: 'markdown',
        prompt: null, labels: null, max_length: null, source: null,
        filter: null, condition: null, if_true_node: null,
        if_false_node: null, duration: null, message: null, level: null
      }
    ]
  },
  {
    plan: {
      title: 'Social Media Content Generator',
      description: 'Generates engaging social media post drafts from cupping notes and customer feedback, then routes through human review before scheduling.',
      prompt: 'Generate social media post drafts for Instagram based on our cupping notes and customer feedback. Create a variety of content types: product highlights, educational content, customer quotes, and behind-the-scenes angles. Route through human review before finalizing.'
    },
    task: {
      title: 'Generate Next Week Social Posts',
      prompt: 'Using our March cupping notes and tasting room feedback, draft 4 Instagram posts for next week. Mix it up: one product highlight (feature a specific coffee), one educational post (something about brewing or tasting), one customer quote (pull from feedback), and one behind-the-scenes angle. Write captions in our voice — warm, knowledgeable, never pretentious. Include hashtag suggestions. Send for review.',
      trigger_type: 'scheduled' as const,
      schedule_config: { cron: '0 10 * * 5', description: 'Every Friday at 10am' },
      input_artifacts: ['March Cupping Notes', 'Tasting Room Feedback — March']
    },
    nodes: [
      {
        id: 'draft_posts',
        type: 'agent_transform',
        description: 'Draft four Instagram posts from the source material.',
        per_artifact: false,
        depends_on: [],
        prompt: 'You are the social media manager for Monument Coffee Co., a specialty roaster in Portland. Using the cupping notes and customer feedback, draft 4 Instagram posts: (1) Product highlight — pick the most interesting coffee and write a caption that makes someone want to try it, (2) Educational — teach something about coffee tasting or brewing in a casual way, (3) Customer spotlight — use a real quote from feedback and build a warm post around it, (4) Behind the scenes — write about the roasting or cupping process. Each post should have a caption (100-200 words), image direction note, and 5-8 hashtags. Brand voice: knowledgeable but approachable, never preachy.',
        labels: null, max_length: null, source: null, filter: null,
        condition: null, if_true_node: null, if_false_node: null,
        duration: null, message: null, title: null, format: null, level: null
      },
      {
        id: 'review_posts',
        type: 'review',
        description: 'Human review of social media drafts before scheduling.',
        per_artifact: false,
        depends_on: ['draft_posts'],
        message: 'Review the 4 drafted Instagram posts. Check that tone matches brand voice, quotes are attributed correctly, and no internal data is accidentally included. Edit captions as needed.',
        prompt: null, labels: null, max_length: null, source: null,
        filter: null, condition: null, if_true_node: null,
        if_false_node: null, duration: null, title: null, format: null, level: null
      },
      {
        id: 'output',
        type: 'emit',
        description: 'Save the approved social media posts.',
        per_artifact: false,
        depends_on: ['review_posts'],
        title: 'Social Media Posts — Week of {{date}}',
        format: 'markdown',
        prompt: null, labels: null, max_length: null, source: null,
        filter: null, condition: null, if_true_node: null,
        if_false_node: null, duration: null, message: null, level: null
      }
    ]
  },
  {
    plan: {
      title: 'Equipment Maintenance Tracker',
      description: 'Scans maintenance logs for overdue or upcoming service items, classifies urgency, and sends notifications for critical items.',
      prompt: 'Review the equipment maintenance log. Identify any service that is overdue or coming due within the next 30 days. Classify each by urgency (overdue, due soon, upcoming). For overdue items, send an alert. Produce a maintenance status report.'
    },
    task: {
      title: 'Equipment Service Check',
      prompt: 'Review the equipment maintenance log. Today is March 15. Flag anything overdue or due within the next 30 days. For each item, note the equipment, service type, due date, and estimated cost if known. Send an alert for any overdue items. Produce a status report with a prioritized action list.',
      trigger_type: 'scheduled' as const,
      schedule_config: { cron: '0 8 1 * *', description: 'First of every month at 8am' },
      input_artifacts: ['Equipment Maintenance Log']
    },
    nodes: [
      {
        id: 'extract_dates',
        type: 'llm_extract',
        description: 'Extract all maintenance items with their due dates and status.',
        per_artifact: false,
        depends_on: [],
        prompt: 'From this maintenance log, extract every scheduled maintenance item. For each, capture: equipment name, service type, due date, technician (if specified), estimated cost (if mentioned), and whether it is overdue, due within 30 days, or upcoming. Today\'s date is March 15, 2026.',
        labels: null, max_length: null, source: null, filter: null,
        condition: null, if_true_node: null, if_false_node: null,
        duration: null, message: null, title: null, format: null, level: null
      },
      {
        id: 'classify_urgency',
        type: 'llm_classify',
        description: 'Classify each maintenance item by urgency level.',
        per_artifact: true,
        depends_on: ['extract_dates'],
        prompt: 'Classify this maintenance item based on its due date relative to today (March 15, 2026).',
        labels: ['overdue', 'due_this_week', 'due_this_month', 'upcoming'],
        max_length: null, source: null, filter: null, condition: null,
        if_true_node: null, if_false_node: null, duration: null,
        message: null, title: null, format: null, level: null
      },
      {
        id: 'check_overdue',
        type: 'branch',
        description: 'Check if any maintenance items are overdue.',
        per_artifact: false,
        depends_on: ['classify_urgency'],
        condition: 'Any item classified as overdue',
        if_true_node: 'alert_overdue',
        if_false_node: 'write_report',
        prompt: null, labels: null, max_length: null, source: null,
        filter: null, duration: null, message: null, title: null,
        format: null, level: null
      },
      {
        id: 'alert_overdue',
        type: 'notify',
        description: 'Send urgent alert for overdue maintenance.',
        per_artifact: false,
        depends_on: ['check_overdue'],
        message: 'OVERDUE maintenance detected. Equipment service is past due and may affect operations or void warranty. See the attached report for details and scheduling priority.',
        level: 'error',
        prompt: null, labels: null, max_length: null, source: null,
        filter: null, condition: null, if_true_node: null,
        if_false_node: null, duration: null, title: null, format: null
      },
      {
        id: 'write_report',
        type: 'emit',
        description: 'Save the maintenance status report.',
        per_artifact: false,
        depends_on: ['check_overdue', 'alert_overdue'],
        title: 'Equipment Maintenance Status — {{date}}',
        format: 'markdown',
        prompt: null, labels: null, max_length: null, source: null,
        filter: null, condition: null, if_true_node: null,
        if_false_node: null, duration: null, message: null, level: null
      }
    ]
  },
  {
    plan: {
      title: 'Subscription Box Curator',
      description: 'Analyzes survey data and cupping scores to design a subscription box offering, computes pricing tiers, and generates a launch proposal for review.',
      prompt: 'Design a coffee subscription box offering based on customer survey data and our current coffee lineup. Consider preferred price points, bag counts, and feature requests. Cross-reference with cupping scores and inventory levels to recommend which coffees to include. Produce a launch proposal with pricing tiers, projected margins, and fulfillment considerations.'
    },
    task: {
      title: 'Design Subscription Box Launch',
      prompt: 'Using the subscription survey results and our cupping notes, design a subscription box offering. Define 2-3 pricing tiers based on the survey price preferences. For each tier, recommend which coffees to include (use cupping scores and customer interest to guide selection). Factor in inventory levels. Produce a launch proposal document covering: tier structure, pricing, expected margin, fulfillment logistics, and a recommended launch timeline. Send for review before finalizing.',
      input_artifacts: ['Subscription Box Survey Results', 'March Cupping Notes', 'Green Bean Inventory']
    },
    nodes: [
      {
        id: 'analyze_demand',
        type: 'agent_code',
        description: 'Parse survey data to determine optimal tier structure and pricing.',
        per_artifact: false,
        depends_on: [],
        prompt: 'Parse the subscription survey JSON. Determine: (1) the most popular bag count, (2) the price sweet spot based on response distribution, (3) the most requested features ranked by votes. Design 2-3 subscription tiers that align with the data. For each tier, specify: name, bags per month, price, and included features. Output as structured markdown.',
        labels: null, max_length: null, source: null, filter: null,
        condition: null, if_true_node: null, if_false_node: null,
        duration: null, message: null, title: null, format: null, level: null
      },
      {
        id: 'curate_coffees',
        type: 'agent_transform',
        description: 'Select coffees for each tier based on scores, popularity, and inventory.',
        per_artifact: false,
        depends_on: ['analyze_demand'],
        prompt: 'Given the subscription tiers, cupping notes (with scores), and inventory levels, recommend specific coffees for each tier. Higher tiers should include higher-scoring single origins. Verify that recommended coffees have sufficient inventory for at least 3 months of subscriptions (estimate 100 subscribers at launch). Flag any inventory constraints. Include a rotation strategy for keeping the box fresh month to month.',
        labels: null, max_length: null, source: null, filter: null,
        condition: null, if_true_node: null, if_false_node: null,
        duration: null, message: null, title: null, format: null, level: null
      },
      {
        id: 'review_proposal',
        type: 'review',
        description: 'Human review of the subscription box proposal before launch.',
        per_artifact: false,
        depends_on: ['curate_coffees'],
        message: 'Review the subscription box proposal. Verify pricing makes sense given our margins, coffee selections are feasible with current inventory, and the tier structure aligns with our brand positioning.',
        prompt: null, labels: null, max_length: null, source: null,
        filter: null, condition: null, if_true_node: null,
        if_false_node: null, duration: null, title: null, format: null, level: null
      },
      {
        id: 'output',
        type: 'emit',
        description: 'Save the subscription box launch proposal.',
        per_artifact: false,
        depends_on: ['review_proposal'],
        title: 'Subscription Box Launch Proposal',
        format: 'markdown',
        prompt: null, labels: null, max_length: null, source: null,
        filter: null, condition: null, if_true_node: null,
        if_false_node: null, duration: null, message: null, level: null
      }
    ]
  },
  {
    plan: {
      title: 'Wholesale Account Health Check',
      description: 'Analyzes order patterns to identify at-risk accounts with declining volumes and generates a retention outreach plan.',
      prompt: 'Analyze wholesale order data to assess account health. Identify accounts with declining order volumes or frequency. For at-risk accounts, draft personalized outreach messages. For healthy accounts, identify upsell opportunities. Produce an account health dashboard and action plan.'
    },
    task: {
      title: 'Q1 Wholesale Account Review',
      prompt: 'Review the Q1 wholesale orders to assess account health. For each account, track month-over-month order volume and product mix changes. Flag any account whose order volume dropped two months in a row. For at-risk accounts, draft a short personalized check-in message. For top-performing accounts, suggest potential upsell opportunities (new products, volume tier upgrades). Produce a summary dashboard.',
      input_artifacts: ['Q1 2026 Wholesale Orders']
    },
    nodes: [
      {
        id: 'analyze_trends',
        type: 'agent_code',
        description: 'Compute per-account monthly trends and flag declining volumes.',
        per_artifact: false,
        depends_on: [],
        prompt: 'Parse the wholesale order CSV. For each account, calculate: total Q1 revenue, order count by month, average order size, product diversity (how many different products). Flag accounts where order volume declined in both Feb and Mar compared to the prior month. Rank all accounts by total spend. Output two markdown tables: (1) full account scorecard, (2) at-risk accounts only.',
        labels: null, max_length: null, source: null, filter: null,
        condition: null, if_true_node: null, if_false_node: null,
        duration: null, message: null, title: null, format: null, level: null
      },
      {
        id: 'classify_accounts',
        type: 'llm_classify',
        description: 'Classify each account as healthy, at-risk, or growth opportunity.',
        per_artifact: true,
        depends_on: ['analyze_trends'],
        prompt: 'Based on the order trend data, classify this wholesale account.',
        labels: ['healthy_growing', 'healthy_stable', 'at_risk_declining', 'at_risk_inactive', 'growth_opportunity'],
        max_length: null, source: null, filter: null, condition: null,
        if_true_node: null, if_false_node: null, duration: null,
        message: null, title: null, format: null, level: null
      },
      {
        id: 'draft_outreach',
        type: 'agent_transform',
        description: 'Draft personalized messages for at-risk and upsell accounts.',
        per_artifact: false,
        depends_on: ['classify_accounts'],
        prompt: 'For each at-risk account, draft a short (3-4 sentence) personalized check-in email from Riley (Operations). Reference their specific order history and ask if anything has changed. For growth opportunity accounts, draft a brief upsell suggestion mentioning a product they haven\'t ordered yet or a volume tier upgrade. Keep the tone friendly and relationship-focused, not salesy.',
        labels: null, max_length: null, source: null, filter: null,
        condition: null, if_true_node: null, if_false_node: null,
        duration: null, message: null, title: null, format: null, level: null
      },
      {
        id: 'output',
        type: 'emit',
        description: 'Save the account health dashboard and outreach plan.',
        per_artifact: false,
        depends_on: ['draft_outreach'],
        title: 'Wholesale Account Health — Q1 2026',
        format: 'markdown',
        prompt: null, labels: null, max_length: null, source: null,
        filter: null, condition: null, if_true_node: null,
        if_false_node: null, duration: null, message: null, level: null
      }
    ]
  },
  {
    plan: {
      title: 'Staff Schedule Optimizer',
      description: 'Cross-references sales patterns with the current staff schedule to identify under- or over-staffed shifts and suggest adjustments.',
      prompt: 'Analyze the staff schedule against sales data patterns. Identify peak revenue days and times. Flag any shifts that appear under-staffed for expected volume or over-staffed during slow periods. Suggest specific schedule adjustments. Wait for a cooling period before finalizing to allow for manual override.'
    },
    task: {
      title: 'Optimize March Staffing',
      prompt: 'Compare the current staff schedule against our Q1 sales data. Our busiest wholesale delivery days and tasting room traffic should drive staffing. Identify any gaps where we might be short-staffed during peak times or over-staffed during slow periods. Suggest specific schedule swaps or additions. Include a 24-hour wait period before finalizing recommendations so the team can weigh in.',
      input_artifacts: ['Staff Schedule — March 2026', 'Q1 2026 Wholesale Orders']
    },
    nodes: [
      {
        id: 'analyze_patterns',
        type: 'agent_code',
        description: 'Cross-reference sales patterns with shift coverage.',
        per_artifact: false,
        depends_on: [],
        prompt: 'Analyze the staff schedule (CSV) and wholesale order patterns (CSV). Determine which days of the week have the highest order volumes. Map staff coverage by role and day. Identify: (1) days with high order volume but thin roasting/operations coverage, (2) days with low activity but heavy staffing, (3) weekend coverage gaps. Output a coverage heat map table and a list of specific concerns.',
        labels: null, max_length: null, source: null, filter: null,
        condition: null, if_true_node: null, if_false_node: null,
        duration: null, message: null, title: null, format: null, level: null
      },
      {
        id: 'suggest_changes',
        type: 'llm_transform',
        description: 'Draft specific schedule adjustment recommendations.',
        per_artifact: false,
        depends_on: ['analyze_patterns'],
        prompt: 'Given the staffing coverage analysis, draft specific schedule change recommendations. For each recommendation: describe the change, explain why (referencing the data), and note any tradeoffs (overtime, employee preferences). Keep suggestions practical — these are real people with real schedules. Limit to 3-5 highest-impact changes.',
        labels: null, max_length: null, source: null, filter: null,
        condition: null, if_true_node: null, if_false_node: null,
        duration: null, message: null, title: null, format: null, level: null
      },
      {
        id: 'wait_for_input',
        type: 'wait',
        description: 'Allow 24 hours for team to review recommendations before finalizing.',
        per_artifact: false,
        depends_on: ['suggest_changes'],
        duration: '24h',
        message: 'Schedule change recommendations are ready. Team has 24 hours to review and provide feedback before the report is finalized.',
        prompt: null, labels: null, max_length: null, source: null,
        filter: null, condition: null, if_true_node: null,
        if_false_node: null, title: null, format: null, level: null
      },
      {
        id: 'output',
        type: 'emit',
        description: 'Save the staffing optimization report.',
        per_artifact: false,
        depends_on: ['wait_for_input'],
        title: 'Staffing Optimization — {{date}}',
        format: 'markdown',
        prompt: null, labels: null, max_length: null, source: null,
        filter: null, condition: null, if_true_node: null,
        if_false_node: null, duration: null, message: null, level: null
      }
    ]
  }
]

export default defineEventHandler(async () => {
  const client = createServiceClient()

  await client.from('reviews').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await client.from('node_runs').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await client.from('jobs').update({ current_run_id: null }).neq('id', '00000000-0000-0000-0000-000000000000')
  await client.from('artifacts').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await client.from('runs').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await client.from('jobs').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await client.from('tasks').update({ plan_id: null }).neq('id', '00000000-0000-0000-0000-000000000000')
  await client.from('plans').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await client.from('tasks').delete().neq('id', '00000000-0000-0000-0000-000000000000')

  const createdArtifacts: Array<{ id: string, title: string }> = []

  for (const artifact of ARTIFACTS) {
    const { data, error } = await client
      .from('artifacts')
      .insert({
        type: artifact.type,
        title: artifact.title,
        content: artifact.content,
        description: artifact.description,
        metadata_json: {}
      })
      .select('id, title')
      .single()

    if (error || !data) {
      throw createError({ statusCode: 500, statusMessage: `Failed to create artifact "${artifact.title}": ${error?.message}` })
    }

    createdArtifacts.push(data)
  }

  const artifactsByTitle = new Map(createdArtifacts.map(a => [a.title, a.id]))

  const createdTasks: Array<{ id: string }> = []
  const createdPlans: Array<{ id: string }> = []

  for (const entry of SEED_DATA) {
    const { data: planData, error: planError } = await client
      .from('plans')
      .insert({
        title: entry.plan.title,
        description: entry.plan.description,
        prompt: entry.plan.prompt,
        plan_json: { nodes: entry.nodes as PlanNode[] },
        version: 1
      })
      .select('id')
      .single()

    if (planError || !planData) {
      throw createError({ statusCode: 500, statusMessage: `Failed to create plan "${entry.plan.title}": ${planError?.message}` })
    }

    createdPlans.push(planData)

    const triggerType = (entry.task.trigger_type || 'manual') as 'manual' | 'scheduled' | 'heartbeat'
    const scheduleConfig = entry.task.schedule_config || {}

    const inputArtifactIds = (entry.task.input_artifacts || [])
      .map(title => artifactsByTitle.get(title))
      .filter((id): id is string => Boolean(id))

    const { data: taskData, error: taskError } = await client
      .from('tasks')
      .insert({
        title: entry.task.title,
        prompt: entry.task.prompt,
        plan_id: planData.id,
        trigger_type: triggerType,
        schedule_config: scheduleConfig,
        input_artifact_ids: inputArtifactIds
      })
      .select('id')
      .single()

    if (taskError || !taskData) {
      throw createError({ statusCode: 500, statusMessage: `Failed to create task "${entry.task.title}": ${taskError?.message}` })
    }

    await client
      .from('plans')
      .update({ task_id: taskData.id })
      .eq('id', planData.id)

    const jobType = triggerType === 'scheduled' ? 'scheduled' : triggerType === 'heartbeat' ? 'heartbeat' : 'one_off'
    const jobStatus = triggerType === 'manual' ? 'idle' : 'scheduled'

    const { error: jobError } = await client
      .from('jobs')
      .insert({
        task_id: taskData.id,
        job_type: jobType,
        status: jobStatus
      })

    if (jobError) {
      throw createError({ statusCode: 500, statusMessage: `Failed to create job for "${entry.task.title}": ${jobError.message}` })
    }

    createdTasks.push(taskData)
  }

  return {
    artifacts: createdArtifacts.length,
    plans: createdPlans.length,
    tasks: createdTasks.length,
    message: `Seeded ${createdArtifacts.length} artifacts, ${createdPlans.length} plans, and ${createdTasks.length} tasks.`
  }
})
