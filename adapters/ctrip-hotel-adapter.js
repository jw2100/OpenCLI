/**
 * Ctrip Hotel Search and Scraping Adapter
 * Handles hotel searching, filtering, and data extraction from Ctrip
 */

const axios = require('axios');
const { JSDOM } = require('jsdom');

class CtripHotelAdapter {
  constructor() {
    this.baseURL = 'https://hotels.ctrip.com';
    this.apiBaseURL = 'https://hotels.ctrip.com/api';
    this.headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Referer': 'https://hotels.ctrip.com/',
    };
  }

  /**
   * Search hotels by destination, dates, and guests
   */
  async searchHotels(destination, checkIn, checkOut, rooms, guests) {
    try {
      console.log(`🔍 Searching hotels in ${destination}...`);
      
      // Get city ID
      const cityId = await this.getCityId(destination);
      if (!cityId) {
        throw new Error(`City ${destination} not found`);
      }

      console.log(`📍 Found city ID: ${cityId}`);

      // Build search URL
      const searchUrl = `${this.baseURL}/hotel/${cityId}-hotels`;
      const params = {
        CheckIn: checkIn,
        CheckOut: checkOut,
        Rooms: rooms,
        Guests: guests,
        SortBy: 'default'
      };

      // Try API first
      const apiUrl = `${this.apiBaseURL}/hotellist`;
      const apiParams = {
        cityId: cityId,
        checkInDate: checkIn,
        checkOutDate: checkOut,
        roomCount: rooms,
        adultCount: guests,
        childCount: 0,
        paymentType: 1,
      };

      try {
        const response = await axios.get(apiUrl, {
          params: apiParams,
          headers: this.headers,
          timeout: 10000
        });

        if (response.data && response.data.hotels) {
          return this.formatHotelResults(response.data.hotels);
        }
      } catch (apiError) {
        console.log('⚠️  API request failed, falling back to HTML scraping...');
      }

      // Fallback to HTML scraping
      return await this.scrapeHotels(searchUrl, params);

    } catch (error) {
      console.error('❌ Error in searchHotels:', error.message);
      throw error;
    }
  }

  /**
   * Get city ID from city name
   */
  async getCityId(cityName) {
    try {
      const cities = {
        '北京': 1,
        '上海': 2,
        '广州': 32,
        '深圳': 30,
        '杭州': 17,
        '成都': 28,
        '西安': 10,
        '重庆': 4,
        '天津': 3,
        '武汉': 477,
        '南京': 12,
        '苏州': 14,
        '长沙': 206,
        '厦门': 25,
      };

      return cities[cityName] || await this.fetchCityId(cityName);
    } catch (error) {
      console.error('Error getting city ID:', error.message);
      return null;
    }
  }

  /**
   * Fetch city ID from Ctrip API
   */
  async fetchCityId(cityName) {
    try {
      const response = await axios.get(`${this.apiBaseURL}/cities/search`, {
        params: { keyword: cityName },
        headers: this.headers
      });

      if (response.data && response.data.cities && response.data.cities.length > 0) {
        return response.data.cities[0].cityId;
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Scrape hotels from HTML
   */
  async scrapeHotels(url, params) {
    try {
      console.log(`🌐 Scraping hotels from ${url}`);
      
      const response = await axios.get(url, {
        params: params,
        headers: this.headers,
        timeout: 15000
      });

      const dom = new JSDOM(response.data);
      const document = dom.window.document;

      const hotels = [];
      const hotelElements = document.querySelectorAll('[data-hotelid]');

      hotelElements.forEach((element) => {
        try {
          const hotel = this.extractHotelData(element);
          if (hotel) {
            hotels.push(hotel);
          }
        } catch (e) {
          console.warn('Error extracting hotel data:', e.message);
        }
      });

      return {
        success: true,
        count: hotels.length,
        hotels: hotels,
        source: 'html_scrape'
      };

    } catch (error) {
      console.error('Error scraping hotels:', error.message);
      return {
        success: false,
        error: error.message,
        hotels: []
      };
    }
  }

  /**
   * Extract hotel data from HTML element
   */
  extractHotelData(element) {
    try {
      const hotelId = element.getAttribute('data-hotelid');
      const nameEl = element.querySelector('[data-hotelname]');
      const priceEl = element.querySelector('.price');
      const ratingEl = element.querySelector('.rating');
      const locationEl = element.querySelector('.location');
      const imageEl = element.querySelector('img[data-src], img[src]');

      return {
        hotelId: hotelId,
        name: nameEl?.textContent?.trim() || 'Unknown',
        price: priceEl?.textContent?.trim() || 'N/A',
        rating: ratingEl?.textContent?.trim() || 'N/A',
        location: locationEl?.textContent?.trim() || 'Unknown',
        image: imageEl?.src || imageEl?.getAttribute('data-src') || '',
        url: `${this.baseURL}/hotel/${hotelId}-reviews.html`,
        features: this.extractFeatures(element),
      };
    } catch (error) {
      console.warn('Error in extractHotelData:', error.message);
      return null;
    }
  }

  /**
   * Extract hotel features/tags
   */
  extractFeatures(element) {
    const features = [];
    const tagElements = element.querySelectorAll('.tag, .feature-tag');
    
    tagElements.forEach((tag) => {
      const text = tag.textContent?.trim();
      if (text) {
        features.push(text);
      }
    });

    return features;
  }

  /**
   * Format API results
   */
  formatHotelResults(hotels) {
    return {
      success: true,
      count: hotels.length,
      hotels: hotels.map(h => ({
        hotelId: h.hotelId,
        name: h.hotelName,
        price: h.lowestPrice,
        rating: h.starRating,
        location: h.address,
        image: h.hotelImg,
        url: `${this.baseURL}/hotel/${h.hotelId}-reviews.html`,
        features: h.tags || [],
      })),
      source: 'api'
    };
  }

  /**
   * Get hotel details and reviews
   */
  async getHotelDetails(hotelId) {
    try {
      const url = `${this.baseURL}/hotel/${hotelId}-reviews.html`;
      const response = await axios.get(url, {
        headers: this.headers,
        timeout: 15000
      });

      const dom = new JSDOM(response.data);
      const document = dom.window.document;

      return {
        success: true,
        hotelId: hotelId,
        name: document.querySelector('h1')?.textContent?.trim(),
        description: document.querySelector('.desc')?.textContent?.trim(),
        images: Array.from(document.querySelectorAll('img.room-img')).map(img => img.src),
        reviews: this.extractReviews(document),
        facilities: this.extractFacilities(document),
      };
    } catch (error) {
      console.error('Error getting hotel details:', error.message);
      return {
        success: false,
        error: error.message,
        hotelId: hotelId
      };
    }
  }

  /**
   * Extract reviews from hotel page
   */
  extractReviews(document) {
    const reviews = [];
    document.querySelectorAll('.review-item').forEach((item) => {
      reviews.push({
        author: item.querySelector('.reviewer')?.textContent?.trim(),
        rating: item.querySelector('.score')?.textContent?.trim(),
        content: item.querySelector('.review-content')?.textContent?.trim(),
        date: item.querySelector('.date')?.textContent?.trim(),
      });
    });
    return reviews;
  }

  /**
   * Extract facilities from hotel page
   */
  extractFacilities(document) {
    const facilities = [];
    document.querySelectorAll('.facility-item').forEach((item) => {
      facilities.push(item.textContent?.trim());
    });
    return facilities;
  }

  /**
   * Filter hotels by criteria
   */
  filterHotels(hotels, criteria) {
    return hotels.filter(hotel => {
      if (criteria.minPrice && !this.parsePrice(hotel.price) >= criteria.minPrice) {
        return false;
      }
      if (criteria.maxPrice && this.parsePrice(hotel.price) > criteria.maxPrice) {
        return false;
      }
      if (criteria.minRating && !this.parseRating(hotel.rating) >= criteria.minRating) {
        return false;
      }
      return true;
    });
  }

  /**
   * Parse price from string
   */
  parsePrice(priceStr) {
    const match = priceStr?.match(/\d+/);
    return match ? parseInt(match[0]) : 0;
  }

  /**
   * Parse rating from string
   */
  parseRating(ratingStr) {
    const match = ratingStr?.match(/\d+\.?\d*/);
    return match ? parseFloat(match[0]) : 0;
  }
}

module.exports = CtripHotelAdapter;
