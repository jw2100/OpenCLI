#!/usr/bin/env node

/**
 * Ctrip.com (携程) Adapter for OpenCLI
 * Handles hotel search, flight booking, and travel information scraping
 * Pattern: C (HTML-based scraping) - No JSON API, no SSR state
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');

class CtripAdapter {
  constructor() {
    this.baseUrl = 'https://www.ctrip.com';
    this.apiBase = 'https://api.ctrip.com';
    this.timeout = 15000;
    this.headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    };
    this.cookies = {};
  }

  /**
   * Search hotels by destination and dates
   */
  async searchHotels(destination, checkIn, checkOut, guests = 1, rooms = 1) {
    try {
      console.log(`\n🔍 Searching hotels in ${destination}...`);
      
      // Format dates (YYYY-MM-DD)
      const checkInDate = this.formatDate(checkIn);
      const checkOutDate = this.formatDate(checkOut);
      
      const searchUrl = `${this.baseUrl}/hotels/search/`;
      
      const params = {
        citycode: await this.getCityCode(destination),
        checkIn: checkInDate,
        checkOut: checkOutDate,
        count: rooms,
        personCount: guests
      };

      const response = await this.makeRequest(searchUrl, { params });
      
      // Parse HTML response
      const $ = cheerio.load(response);
      const hotels = this.parseHotels($);
      
      return {
        success: true,
        destination,
        checkIn: checkInDate,
        checkOut: checkOutDate,
        rooms,
        guests,
        resultsCount: hotels.length,
        hotels: hotels.slice(0, 10) // Return top 10
      };
    } catch (error) {
      return this.handleError('searchHotels', error);
    }
  }

  /**
   * Search flights
   */
  async searchFlights(from, to, departDate, returnDate = null, passengers = 1) {
    try {
      console.log(`\n✈️  Searching flights from ${from} to ${to}...`);
      
      const departDateFormatted = this.formatDate(departDate);
      
      const searchUrl = 'https://flights.ctrip.com/itinerary/oneway';
      
      const params = {
        from: from.toUpperCase(),
        to: to.toUpperCase(),
        date: departDateFormatted,
        returnDate: returnDate ? this.formatDate(returnDate) : null,
        passengers
      };

      const response = await this.makeRequest(searchUrl, { params });
      const flights = this.parseFlights(response);

      return {
        success: true,
        from,
        to,
        departDate: departDateFormatted,
        returnDate: returnDate ? this.formatDate(returnDate) : null,
        passengers,
        resultsCount: flights.length,
        flights: flights.slice(0, 10)
      };
    } catch (error) {
      return this.handleError('searchFlights', error);
    }
  }

  /**
   * Get destination information and guides
   */
  async getDestinationInfo(city) {
    try {
      console.log(`\n📍 Fetching information about ${city}...`);
      
      const guideUrl = `${this.baseUrl}/you/place/${city}/`;
      
      const response = await this.makeRequest(guideUrl);
      const $ = cheerio.load(response);
      
      const info = {
        city,
        attractions: this.parseAttractions($),
        restaurants: this.parseRestaurants($),
        tips: this.parseTravelTips($),
        bestTime: this.extractBestTime($),
        weather: this.extractWeather($)
      };

      return {
        success: true,
        data: info
      };
    } catch (error) {
      return this.handleError('getDestinationInfo', error);
    }
  }

  /**
   * Extract tour packages
   */
  async getTourPackages(destination, duration = null) {
    try {
      console.log(`\n🎫 Fetching tour packages for ${destination}...`);
      
      const toursUrl = `${this.baseUrl}/vacations/`;
      
      const params = {
        destination,
        ...(duration && { duration })
      };

      const response = await this.makeRequest(toursUrl, { params });
      const packages = this.parseTourPackages(response);

      return {
        success: true,
        destination,
        duration,
        packagesCount: packages.length,
        packages: packages.slice(0, 10)
      };
    } catch (error) {
      return this.handleError('getTourPackages', error);
    }
  }

  /**
   * Make HTTP request with cookies and headers
   */
  async makeRequest(url, options = {}) {
    try {
      const config = {
        method: options.method || 'GET',
        url,
        headers: { ...this.headers },
        timeout: this.timeout,
        ...options
      };

      // Add cookies if available
      if (Object.keys(this.cookies).length > 0) {
        config.headers['Cookie'] = this.formatCookies();
      }

      const response = await axios(config);
      
      // Store cookies for future requests
      if (response.headers['set-cookie']) {
        this.parseCookies(response.headers['set-cookie']);
      }

      return response.data;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Parse hotels from HTML
   */
  parseHotels($) {
    const hotels = [];
    
    // Selector may vary - adapt based on actual HTML structure
    const hotelElements = $('[data-hotel-id]') || $('.hotel-item');
    
    hotelElements.each((index, element) => {
      const $el = $(element);
      
      const hotel = {
        id: $el.attr('data-hotel-id') || $el.attr('id'),
        name: $el.find('.hotel-name, h2').text().trim(),
        price: $el.find('.price, .hotel-price').text().trim(),
        rating: $el.find('.rating, .star').text().trim(),
        location: $el.find('.location, .address').text().trim(),
        reviews: $el.find('.reviews, .comment-count').text().trim(),
        amenities: this.extractAmenities($el),
        link: $el.find('a').attr('href')
      };

      if (hotel.name && hotel.price) {
        hotels.push(hotel);
      }
    });

    return hotels;
  }

  /**
   * Parse flights from HTML
   */
  parseFlights(html) {
    const $ = cheerio.load(html);
    const flights = [];

    const flightElements = $('[data-flight-id]') || $('.flight-item');
    
    flightElements.each((index, element) => {
      const $el = $(element);
      
      const flight = {
        id: $el.attr('data-flight-id'),
        airline: $el.find('.airline').text().trim(),
        departure: $el.find('.departure-time').text().trim(),
        arrival: $el.find('.arrival-time').text().trim(),
        duration: $el.find('.duration').text().trim(),
        price: $el.find('.price').text().trim(),
        seats: $el.find('.seats-left').text().trim(),
        stops: $el.find('.stops').text().trim() || '0',
        link: $el.find('a').attr('href')
      };

      if (flight.airline && flight.departure) {
        flights.push(flight);
      }
    });

    return flights;
  }

  /**
   * Parse attractions from HTML
   */
  parseAttractions($) {
    const attractions = [];
    
    const attractionElements = $('.attraction-item, [data-attraction-id]');
    
    attractionElements.each((index, element) => {
      const $el = $(element);
      
      const attraction = {
        name: $el.find('.name, h3').text().trim(),
        rating: $el.find('.rating').text().trim(),
        reviews: $el.find('.review-count').text().trim(),
        type: $el.find('.type, .category').text().trim(),
        image: $el.find('img').attr('src'),
        link: $el.find('a').attr('href')
      };

      if (attraction.name) {
        attractions.push(attraction);
      }
    });

    return attractions;
  }

  /**
   * Parse restaurants from HTML
   */
  parseRestaurants($) {
    const restaurants = [];
    
    const restaurantElements = $('.restaurant-item, [data-restaurant-id]');
    
    restaurantElements.each((index, element) => {
      const $el = $(element);
      
      const restaurant = {
        name: $el.find('.name, h3').text().trim(),
        cuisine: $el.find('.cuisine').text().trim(),
        rating: $el.find('.rating').text().trim(),
        avgPrice: $el.find('.avg-price').text().trim(),
        image: $el.find('img').attr('src'),
        link: $el.find('a').attr('href')
      };

      if (restaurant.name) {
        restaurants.push(restaurant);
      }
    });

    return restaurants;
  }

  /**
   * Parse tour packages from HTML
   */
  parseTourPackages(html) {
    const $ = cheerio.load(html);
    const packages = [];

    const packageElements = $('.tour-package, [data-package-id]');
    
    packageElements.each((index, element) => {
      const $el = $(element);
      
      const pkg = {
        id: $el.attr('data-package-id'),
        name: $el.find('.package-name, h2').text().trim(),
        days: $el.find('.duration-days').text().trim(),
        price: $el.find('.package-price').text().trim(),
        rating: $el.find('.rating').text().trim(),
        type: $el.find('.package-type').text().trim(),
        description: $el.find('.description, .summary').text().trim(),
        image: $el.find('img').attr('src'),
        link: $el.find('a').attr('href')
      };

      if (pkg.name && pkg.price) {
        packages.push(pkg);
      }
    });

    return packages;
  }

  /**
   * Extract amenities from hotel element
   */
  extractAmenities($element) {
    const amenities = [];
    const amenityElements = $element.find('.amenity, .facility');
    
    amenityElements.each((index, element) => {
      const amenity = $(element).text().trim();
      if (amenity) amenities.push(amenity);
    });
    
    return amenities;
  }

  /**
   * Extract best time to visit
   */
  extractBestTime($) {
    return $('[data-best-time]').text().trim() || 
           $('.best-time').text().trim() ||
           'N/A';
  }

  /**
   * Extract weather information
   */
  extractWeather($) {
    return $('[data-weather]').text().trim() || 
           $('.weather-info').text().trim() ||
           'N/A';
  }

  /**
   * Parse travel tips
   */
  parseTravelTips($) {
    const tips = [];
    const tipElements = $('.travel-tip, [data-tip]');
    
    tipElements.each((index, element) => {
      const tip = $(element).text().trim();
      if (tip) tips.push(tip);
    });
    
    return tips;
  }

  /**
   * Get city code from city name
   */
  async getCityCode(cityName) {
    // Common city codes mapping
    const cityCodeMap = {
      '北京': 1, '上海': 2, '广州': 32, '深圳': 30,
      '南京': 12, '杭州': 17, '成都': 28, '厦门': 25,
      '青岛': 7, '三亚': 43, '西安': 10, '武汉': 477,
      '昆明': 34, '长沙': 206, '苏州': 14, '哈尔滨': 5,
      '澳门': 59, '天津': 3, '重庆': 4, '大连': 6
    };
    
    return cityCodeMap[cityName] || cityName;
  }

  /**
   * Format date to YYYY-MM-DD
   */
  formatDate(date) {
    if (typeof date === 'string') return date;
    
    const d = new Date(date);
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    
    return `${d.getFullYear()}-${month}-${day}`;
  }

  /**
   * Parse cookies from Set-Cookie headers
   */
  parseCookies(cookieHeaders) {
    cookieHeaders.forEach(header => {
      const parts = header.split(';')[0].split('=');
      if (parts.length === 2) {
        this.cookies[parts[0].trim()] = parts[1].trim();
      }
    });
  }

  /**
   * Format cookies for request headers
   */
  formatCookies() {
    return Object.entries(this.cookies)
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');
  }

  /**
   * Handle and format errors
   */
  handleError(operation, error) {
    console.error(`❌ Error in ${operation}:`, error.message);
    
    return {
      success: false,
      operation,
      error: error.message,
      code: error.code || 'UNKNOWN_ERROR',
      details: {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText
      }
    };
  }
}

/**
 * CLI Interface
 */
async function main() {
  const adapter = new CtripAdapter();
  
  const command = process.argv[2];
  const args = process.argv.slice(3);

  try {
    switch (command) {
      case 'hotel-search':
        const [dest, checkIn, checkOut, guests, rooms] = args;
        const hotelResult = await adapter.searchHotels(
          dest,
          checkIn,
          checkOut,
          guests || 1,
          rooms || 1
        );
        console.log(JSON.stringify(hotelResult, null, 2));
        break;

      case 'flight-search':
        const [from, to, date, returnDate, passengers] = args;
        const flightResult = await adapter.searchFlights(
          from,
          to,
          date,
          returnDate,
          passengers || 1
        );
        console.log(JSON.stringify(flightResult, null, 2));
        break;

      case 'destination-info':
        const city = args[0];
        const infoResult = await adapter.getDestinationInfo(city);
        console.log(JSON.stringify(infoResult, null, 2));
        break;

      case 'tour-packages':
        const [tourDest, duration] = args;
        const packageResult = await adapter.getTourPackages(tourDest, duration);
        console.log(JSON.stringify(packageResult, null, 2));
        break;

      default:
        console.log(`
🛫 Ctrip.com (携程) Adapter for OpenCLI

Usage:
  node ctrip.js hotel-search <destination> <checkIn> <checkOut> [guests] [rooms]
  node ctrip.js flight-search <from> <to> <date> [returnDate] [passengers]
  node ctrip.js destination-info <city>
  node ctrip.js tour-packages <destination> [duration]

Examples:
  node ctrip.js hotel-search 北京 2024-12-20 2024-12-22 2 1
  node ctrip.js flight-search SHA CGO 2024-12-20 2024-12-22 1
  node ctrip.js destination-info 西安
  node ctrip.js tour-packages 三亚 3

Pattern: C (HTML-based scraping)
No JSON API detected | No SSR state | Use browser context for full functionality
        `);
    }
  } catch (error) {
    console.error('Fatal error:', error.message);
    process.exit(1);
  }
}

// Export for module usage
module.exports = CtripAdapter;

// Run CLI if executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });
}
