// One entry per company. `platform` names an adapter in src/adapters/.
// noFee: true only where the company's own site says its rentals are no-fee.
export const COMPANIES = [
    // Related Rentals: own Drupal site, search results paged 12 at a time
    { slug: 'related', company: 'Related Rentals', platform: 'related' },
    // Glenwood Management: own WordPress site, one all-units search page
    { slug: 'glenwood', company: 'Glenwood Management', platform: 'glenwood' },
    // Stonehenge NYC: Webflow CMS, one all-units page
    { slug: 'stonehenge', company: 'Stonehenge NYC', platform: 'stonehenge' },
    // TF Cornerstone: own JSON (one CDN file with every listed unit); site says No Fee
    { slug: 'tf-cornerstone', company: 'TF Cornerstone', platform: 'tfc', noFee: true },
    // Rockrose: own WordPress /availabilities/ page; header says "No Fee Listings"
    { slug: 'rockrose', company: 'Rockrose', platform: 'rockrose', noFee: true },
    // LeFrak: Spherexx property sites (POST /ajax/getunitlist.asp)
    { slug: 'lefrak', company: 'LeFrak', platform: 'spherexx', sites: [
        { url: 'https://www.kingsqueensapts.com/queens/available-rentals-nyc/', noFee: true },
        { url: 'https://www.lefrakcity.com/', borough: 'Queens', neighbourhood: 'Corona', zip: '11368', noFee: true },
        { url: 'https://www.gatewayny.com/', borough: 'Manhattan', neighbourhood: 'Battery Park City', zip: '10280' } ] },
    // Two Trees: Nestio/Funnel feed proxied by their own site; noFee per listing
    { slug: 'two-trees', company: 'Two Trees', platform: 'nestio', feedUrl: 'https://www.twotreesny.com/api/nestio', siteUrl: 'https://www.twotreesny.com/', urlStyle: 'twotrees' },
    // Douglaston Development: one site per building, two page layouts
    { slug: 'douglaston', company: 'Douglaston Development', platform: 'douglaston', buildings: [
        { name: '3ELEVEN', url: 'https://3elevennyc.com/availability/', layout: 'avblock', street: '311 11th Avenue', zip: '10001', neighbourhood: 'West Chelsea' },
        { name: 'OHM', url: 'https://ohmny.com/availability/', layout: 'avblock', street: '312 11th Avenue', zip: '10001', neighbourhood: 'West Chelsea' },
        { name: 'One North Fourth', url: 'https://1n4th.com/availability/', layout: 'avblock', street: '1 North 4th Place', zip: '11249', neighbourhood: 'Williamsburg' },
        { name: 'AtlanticBK', url: 'https://atlanticbk.com/availability', layout: 'mnstable', street: '1057 Atlantic Avenue', zip: '11238', neighbourhood: 'Bedford-Stuyvesant' } ] },
    // AvalonBay: NYC region search page embeds every unit (Fusion.globalContent JSON)
    { slug: 'avalonbay', company: 'AvalonBay', platform: 'avalon', regions: ['/new-york/new-york-city-apartments/'] },
    // Durst: Nuxt building sites, /availabilities/_payload.json (Nestio / MRI items)
    { slug: 'durst', company: 'The Durst Organization', platform: 'durst', sites: ['https://www.via57west.com', 'https://www.helena57west.com', 'https://www.frank57west.com', 'https://www.eosnomad.com', 'https://svenlic.com', 'https://www.hallettspoint.com'] },
    // Brookfield Properties: portfolio page -> each NYC building's SightMap embed
    { slug: 'brookfield', company: 'Brookfield Properties', platform: 'brookfield' },
    // Greystar: NYC market page -> property pages' Next.js flight data; buildings
    // without prices fall back to their own (Jonah Digital) sites, The Brook to RentCafe (browser)
    { slug: 'greystar', company: 'Greystar', platform: 'greystar', browser: true, rentcafeBuildings: ['The Brook'] },
    // Bozzuto: SightMap embeds (plain HTTP; ids pinned for the Cloudflare-blocked sites);
    // 19 Dutch and Riverbank are floor-plan level only, read in the browser
    { slug: 'bozzuto', company: 'Bozzuto', platform: 'bozzuto', browser: true, properties: [
        { name: '475 Clermont', street: '475 Clermont Avenue', zip: '11238', neighbourhood: 'Clinton Hill', lat: 40.6835263, lon: -73.9687599, url: 'https://www.475clermont.com/floor-plans/' },
        { name: 'Magnolia DUMBO', street: '160 Front Street', zip: '11201', neighbourhood: 'DUMBO', lat: 40.7020245, lon: -73.9855741, url: 'https://www.magnolia-dumbo.com/floor-plans/' },
        { name: 'Maven', street: '2413 Third Avenue', zip: '10451', neighbourhood: 'Mott Haven', lat: 40.808673, lon: -73.931555, url: 'https://www.mavenbx.com/floor-plans/' },
        { name: '88 Leonard', street: '88 Leonard Street', zip: '10013', neighbourhood: 'Tribeca', lat: 40.7168743, lon: -74.0047645, url: 'https://88leonard.com/floorplans/' },
        { name: 'Aalto57', street: '1065 Second Avenue', zip: '10022', neighbourhood: 'Sutton Place', url: 'https://www.aalto57.com/floor-plans/', embed: '27vq1rlkwox' },
        { name: 'Eighty Nine DeKalb', street: '89 DeKalb Avenue', zip: '11201', neighbourhood: 'Fort Greene', url: 'https://www.eightyninedekalb.com/availability', embed: '8epm6znkv6d' },
        { name: '19 Dutch', street: '19 Dutch Street', zip: '10038', neighbourhood: 'Financial District', lat: 40.709964, lon: -74.00732, fpPage: 'https://www.19dutch.com/floor-plans/' },
        { name: 'Riverbank', street: '560 West 43rd Street', zip: '10036', neighbourhood: "Hell's Kitchen", lat: 40.761323, lon: -73.997821, fpPage: 'https://www.riverbankny.com/floor-plans/' } ] },
    // Stellar Management: own Nuxt CMS API (/cmsapi/unit/search); URLs say no-fee
    { slug: 'stellar', company: 'Stellar Management', platform: 'stellar', noFee: true },
    // Brodsky: Next.js page data on /rentals
    { slug: 'brodsky', company: 'The Brodsky Organization', platform: 'brodsky' },
    // Manhattan Skyline: own Laravel /api/units; listings say no fees
    { slug: 'manhattan-skyline', company: 'Manhattan Skyline', platform: 'manhattanskyline', noFee: true },
    // Goldfarb Properties: server-rendered HTML
    { slug: 'goldfarb', company: 'Goldfarb Properties', platform: 'goldfarb' },
    // Bettina Equities: WordPress apartments_api.php (empty when fully rented)
    { slug: 'bettina', company: 'Bettina Equities', platform: 'bettina' },
    // ---- browser companies (Cloudflare-protected sites; Chrome over the residential proxy) ----

    // Equity Residential: NYC metro page + one page per property (ea5.unitAvailability).
    // ~49 page loads per crawl (first load per property is a CF 403, retried), so refreshed
    // every 12h; rows are replayed from cache in between.
    { slug: 'equity', company: 'Equity Residential', platform: 'equity', browser: true, minIntervalHours: 12 },
    // Gotham Organization: building sites' /wp-json/component/units/ feeds (browser only for 3 CF sites)
    { slug: 'gotham', company: 'Gotham Organization', platform: 'gotham', browser: true, sites: [
        { name: 'AIRE', url: 'https://aireny.com/' },
        { name: 'The Maybury', url: 'https://themaybury.com/' },
        { name: 'The Ashland', url: 'https://www.theashlandbk.com/', page: 'https://www.theashlandbk.com/#Availability' },
        { name: 'The Nicole', url: 'https://www.thenicole.com/', page: 'https://www.thenicole.com/#Availability' },
        { name: 'The Suffolk', url: 'https://thesuffolk.com/', browser: true },
        { name: 'Atlas New York', url: 'https://www.atlasny.com/', page: 'https://www.atlasny.com/#Availability', browser: true },
        { name: 'Gotham West', url: 'https://www.gothamwestnyc.com/', page: 'https://www.gothamwestnyc.com/#Availability', browser: true },
        { name: 'Gotham Point', layout: 'gothampoint', url: 'https://gothampoint.com/availability/', street: '1-15 57th Avenue', zip: '11101', neighbourhood: 'Long Island City' } ] },
    // Moinian: RentCafe building sites behind Cloudflare, one /availableunits page each
    { slug: 'moinian', company: 'The Moinian Group', platform: 'rentcafe', browser: true, sites: [
        { name: 'SKY', url: 'https://www.liveatsky.com', neighbourhood: "Hell's Kitchen" },
        { name: 'ARIA', url: 'https://www.liveatarianyc.com', neighbourhood: 'Financial District' },
        { name: 'Aria 7 Platt', url: 'https://www.liveataria7platt.com', neighbourhood: 'Financial District' },
        { name: 'One West', url: 'https://www.liveatonewestnyc.com', neighbourhood: 'Financial District' },
        { name: 'Marc', url: 'https://www.liveatmarcnyc.com', neighbourhood: 'Midtown West' } ] },
    // Dalan Rentals: RentCafe company search -> ~31 NYC properties' /availableunits (browser);
    // ~32 pages per crawl, so refreshed every 12h and replayed in between
    { slug: 'dalan', company: 'Dalan Rentals', platform: 'rentcafe', browser: true, minIntervalHours: 12, discover: 'https://www.dalanrentals.com/searchlisting' },

    // Rose Associates: building sites embed availability.rosenyc.com tables (plain HTTP; codes pinned)
    { slug: 'rose', company: 'Rose Associates', platform: 'rose', buildings: [
        { name: '70 Pine', code: 'difiglnh', street: '70 Pine Street', zip: '10005', neighbourhood: 'Financial District', url: 'https://70pine.com/availability/' },
        { name: '21 West Street', code: 'mgpemqoe', street: '21 West Street', zip: '10006', neighbourhood: 'Financial District', url: 'https://www.21west.com/availabilities' },
        { name: 'The Metropolis', code: 'mgooldnp', street: '150 East 44th Street', zip: '10017', neighbourhood: 'Midtown East', url: 'https://www.themetropolis.com/availabilities' },
        { name: 'The Ellington', code: 'mgptaneh', street: '260 West 52nd Street', zip: '10019', neighbourhood: 'Midtown West', url: 'https://www.ellingtonnyc.com/availabilities' },
        { name: 'The Sutton Collection', code: 'mgoolbcd', zip: '10022', neighbourhood: 'Sutton Place', url: 'https://www.thesuttoncollection.com/availabilities' },
        { name: 'The Caldwell', code: 'mgofgdmf', street: '1520 York Avenue', zip: '10028', neighbourhood: 'Upper East Side', url: 'https://www.rentthecaldwell.com/availabilities' },
        { name: 'Carnegie Mews', code: 'mgopcrgs', street: '211 West 56th Street', zip: '10019', neighbourhood: 'Midtown West', url: 'https://www.carnegiemews.com/availabilities' },
        { name: 'The Maximilian', code: 'mgpkkmnn', street: '5-11 47th Avenue', zip: '11101', neighbourhood: 'Long Island City', url: 'https://www.themaximilian.com/availabilities' },
        { name: 'Anagram Columbus Circle', code: 'mgpfgbno', zip: '10023', neighbourhood: 'Upper West Side', url: 'https://anagramcolumbuscircle.com/availability/' },
        { name: 'Anagram Turtle Bay', code: 'mgpfgmnj', street: '300 East 50th Street', zip: '10022', neighbourhood: 'Turtle Bay', url: 'https://anagramturtlebay.com/turtle-bay-apartment-availability' },
        { name: 'Aura', code: 'mgotcrro', street: '23-10 42nd Road', zip: '11101', neighbourhood: 'Long Island City', url: 'https://aura-lic.com/availability/' },
        { name: '8 Court Square', code: 'mgoparmf', street: '27-05 Thomson Avenue', zip: '11101', neighbourhood: 'Long Island City', url: 'https://www.8courtsq.com/availability/' },
        { name: 'Echelon Chelsea', code: 'mgpfedos', street: '37 West 21st Street', zip: '10010', neighbourhood: 'Chelsea', url: 'https://www.echelonchelsea.com/availability/' },
        { name: 'Forty Six Fifty', code: 'mgpelboo', street: '4650 Broadway', zip: '10040', neighbourhood: 'Inwood', url: 'https://www.fortysixfifty.com/availability/' },
        { name: 'The Smile', code: 'mgpkbhio', street: '158 East 126th Street', zip: '10035', neighbourhood: 'East Harlem', url: 'https://www.thesmile.com/availability/' },
        { name: 'Eve East Village', code: 'dsfqqlid', street: '433 East 13th Street', zip: '10009', neighbourhood: 'East Village', url: 'https://eve.nyc/check-availability/' },
        { name: 'The Lotus', code: 'hgpiecgh', street: '255 East 39th Street', zip: '10016', neighbourhood: 'Murray Hill', url: 'https://thelotusnyc.com/availability' },
        { name: 'Ruby', code: 'hgpiehrt', street: '243 West 28th Street', zip: '10001', neighbourhood: 'Chelsea', url: 'https://rubychelsea.com/availability/' },
        { name: 'London Terrace Gardens', code: 'mgpoldcj', street: '415 West 23rd Street', zip: '10011', neighbourhood: 'Chelsea', url: 'https://www.londonterrace.com/availabilities' },
        { name: 'Chelsea Landmark', code: 'msdigldp', street: '55 West 25th Street', zip: '10010', neighbourhood: 'Chelsea', url: 'https://www.chelsealandmark.com/' },
        { name: '7 West 21st', code: 'mgoublmo', street: '7 West 21st Street', zip: '10010', neighbourhood: 'Flatiron', url: 'https://www.7w21.com/' },
        { name: '301 East 94th Street', code: 'mgoelfit', street: '301 East 94th Street', zip: '10128', neighbourhood: 'Upper East Side', url: 'https://www.301e94apts.com/availabilities' } ] },
];
