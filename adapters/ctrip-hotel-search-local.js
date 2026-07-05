/**
 * Ctrip Hotel Search Adapter for OpenCLI
 * Uses browser-based scraping to search hotels on Ctrip
 * Pattern: C (HTML-based dynamic rendering)
 * 
 * 使用说明：
 * opencli browser init ctrip/hotel-search
 * # 编辑 ~/.opencli/clis/ctrip/hotel-search.js
 * opencli browser verify ctrip/hotel-search --write-fixture --seed-args '["北京", "2026-07-07", "2026-07-09", 1, 2]'
 */

const { EmptyResultError, ArgumentError } = require('@jackwener/opencli/errors');

module.exports = {
  name: 'hotel-search',
  description: 'Search hotels on Ctrip by destination and dates',
  site: 'ctrip',
  browser: true, // 使用浏览器模式

  args: [
    { 
      name: 'destination', 
      required: true, 
      description: 'Hotel destination city (北京, 上海, 杭州, etc)' 
    },
    { 
      name: 'checkIn', 
      required: true, 
      description: 'Check-in date (YYYY-MM-DD)' 
    },
    { 
      name: 'checkOut', 
      required: true, 
      description: 'Check-out date (YYYY-MM-DD)' 
    },
    { 
      name: 'rooms', 
      default: 1, 
      description: 'Number of rooms' 
    },
    { 
      name: 'guests', 
      default: 2, 
      description: 'Number of guests' 
    },
  ],

  columns: [
    { name: 'hotelId', type: 'string', description: 'Hotel ID' },
    { name: 'name', type: 'string', description: 'Hotel name' },
    { name: 'price', type: 'string', description: 'Price (CNY)' },
    { name: 'rating', type: 'string', description: 'Star rating' },
    { name: 'location', type: 'string', description: 'Address' },
    { name: 'reviews', type: 'string', description: 'Review count' },
    { name: 'features', type: 'string', description: 'Hotel features' },
    { name: 'url', type: 'string', description: 'Hotel details link' },
  ],

  async func(page, args) {
    const { destination, checkIn, checkOut, rooms = 1, guests = 2 } = args;

    // Validate params
    if (!destination || !checkIn || !checkOut) {
      throw new ArgumentError('destination, checkIn, checkOut required');
    }

    try {
      console.log(`🏨 Searching for hotels in ${destination}...`);

      // Step 1: Navigate to Ctrip
      await page.goto('https://www.ctrip.com/', { 
        waitUntil: 'networkidle2',
        timeout: 30000 
      });
      
      await page.waitForTimeout(2000);

      // Step 2: Find and fill destination input
      console.log(`📍 Entering destination: ${destination}`);
      
      const destSelectors = [
        'input[data-test="hotel-city"]',
        'input[placeholder*="城市"]',
        'input[placeholder*="目的地"]',
        'input[data-field="city"]',
        '.city-input'
      ];

      let destInputFilled = false;
      for (const sel of destSelectors) {
        try {
          const elem = await page.$(sel);
          if (elem) {
            await page.click(sel);
            await page.type(sel, destination, { delay: 50 });
            destInputFilled = true;
            break;
          }
        } catch (e) {
          // Try next selector
        }
      }

      if (!destInputFilled) {
        throw new ArgumentError('Cannot find destination input');
      }

      await page.waitForTimeout(1000);

      // Try to click city from dropdown
      try {
        await page.click('.city-list li, [data-city]', { timeout: 5000 });
      } catch (e) {
        await page.keyboard.press('Enter');
      }

      await page.waitForTimeout(1000);

      // Step 3: Fill check-in date
      console.log(`📅 Check-in: ${checkIn}`);
      const checkinSels = [
        'input[data-test="hotel-checkin"]',
        'input[placeholder*="入住"]',
        'input.checkin-date'
      ];

      for (const sel of checkinSels) {
        try {
          await page.click(sel);
          await page.type(sel, checkIn, { delay: 50 });
          break;
        } catch (e) {
          // Try next
        }
      }

      await page.waitForTimeout(500);

      // Step 4: Fill check-out date
      console.log(`📅 Check-out: ${checkOut}`);
      const checkoutSels = [
        'input[data-test="hotel-checkout"]',
        'input[placeholder*="离店"]',
        'input.checkout-date'
      ];

      for (const sel of checkoutSels) {
        try {
          await page.click(sel);
          await page.type(sel, checkOut, { delay: 50 });
          break;
        } catch (e) {
          // Try next
        }
      }

      await page.waitForTimeout(500);

      // Step 5: Click search
      console.log('🔍 Clicking search...');
      const searchBtnSels = [
        'button[data-test="search"]',
        'button[class*="search"]',
        '.search-btn'
      ];

      let searchClicked = false;
      for (const sel of searchBtnSels) {
        try {
          await page.click(sel);
          searchClicked = true;
          break;
        } catch (e) {
          // Try next
        }
      }

      if (!searchClicked) {
        throw new Error('Search button not found');
      }

      // Step 6: Wait for results
      console.log('⏳ Loading results...');
      try {
        await page.waitForSelector(
          '.hotel-item, [data-hotelid], .search-result-item',
          { timeout: 15000 }
        );
      } catch (e) {
        throw new EmptyResultError(`No hotels found for ${destination}`);
      }

      await page.waitForTimeout(2000);

      // Step 7: Extract hotel data
      console.log('📊 Extracting data...');
      const hotels = await page.evaluate(() => {
        const results = [];
        const selectors = '.hotel-item, [data-hotelid], .search-result-item';
        const elements = document.querySelectorAll(selectors);

        elements.forEach((el, idx) => {
          try {
            const hotel = {
              hotelId: el.getAttribute('data-hotelid') || `h${idx}`,
              name: (el.querySelector('h2, h3, .hotel-name')?.textContent || '').trim(),
              price: (el.querySelector('.price, .hotel-price')?.textContent || 'N/A').trim(),
              rating: (el.querySelector('.rating, .star')?.textContent || 'N/A').trim(),
              location: (el.querySelector('.location, .address')?.textContent || '').trim(),
              reviews: (el.querySelector('.review-count')?.textContent || '0').trim(),
              features: Array.from(el.querySelectorAll('.tag, .feature'))
                .map(t => t.textContent?.trim())
                .filter(t => t)
                .join('; '),
              url: el.querySelector('a[href*="hotel"]')?.href || ''
            };
            
            if (hotel.name) results.push(hotel);
          } catch (err) {
            console.warn('Parse error:', err.message);
          }
        });

        return results;
      });

      if (!hotels || hotels.length === 0) {
        throw new EmptyResultError(`No hotels found for ${destination}`);
      }

      console.log(`✓ Found ${hotels.length} hotels`);
      return hotels.slice(0, 20);

    } catch (error) {
      if (error instanceof EmptyResultError || error instanceof ArgumentError) {
        throw error;
      }
      console.error('❌ Error:', error.message);
      throw error;
    }
  }
};
