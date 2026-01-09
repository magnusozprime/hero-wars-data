const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const API_URL = 'https://community-api.hero-wars.com/api/posts/published?page=1';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Origin': 'https://community.hero-wars.com',
  'Referer': 'https://community.hero-wars.com/'
};

async function run() {
  console.log("🕵️‍♂️ DEBUG MODE STARTED");

  try {
    // 1. Fetch Data
    console.log("1. Connecting to API...");
    const response = await axios.get(API_URL, { headers: HEADERS });
    
    // DEBUG: Print the top-level keys to ensure we are parsing correctly
    console.log(`DEBUG: API Status: ${response.status}`);
    console.log(`DEBUG: Top Keys: ${Object.keys(response.data).join(', ')}`);

    // Handle different API shapes
    let posts = [];
    if (Array.isArray(response.data)) {
      posts = response.data;
    } else if (response.data.results) {
      posts = response.data.results;
    } else if (response.data.data) {
      posts = response.data.data;
    }

    console.log(`DEBUG: Found ${posts.length} posts.`);

    if (posts.length === 0) {
      console.log("❌ CRITICAL: No posts found. The API might have blocked us or changed format.");
      return;
    }

    // 2. Analyze ONLY the first 3 posts (to keep logs readable)
    console.log("2. Analyzing content of newest 3 posts...");
    
    for (let i = 0; i < Math.min(posts.length, 3); i++) {
      const post = posts[i];
      const rawString = JSON.stringify(post); // Flatten object to string
      
      console.log(`\n--- POST #${post.id} ---`);
      
      // DEBUG: Print a snippet of the body to see if links are hidden
      console.log(`DEBUG: Raw Content Snippet: ${rawString.substring(0, 200)}...`);

      // 3. Ultra-Wide Regex (Catch EVERYTHING that looks like a link)
      // We are looking for http:// or https:// followed by NOT a space/quote
      const catchAllRegex = /https?:\/\/[^\s"']+/g;
      const allLinks = rawString.match(catchAllRegex) || [];

      console.log(`DEBUG: Links found in this post: ${allLinks.length}`);
      if (allLinks.length > 0) {
        console.log(`DEBUG: URLs: ${allLinks.join('  ,  ')}`);
      }

      // 4. Test Validation on these links
      for (const link of allLinks) {
        // Only check links that look suspicious (shorteners or official)
        if (link.includes('herowars') || link.includes('hero-wars') || link.includes('bit.ly')) {
          const cleanLink = link.replace(/\\/g, ''); // Fix escaped slashes
          console.log(`   > Testing Validatator on: ${cleanLink}`);
          
          try {
            const check = await axios.get(cleanLink, { 
              headers: HEADERS, 
              maxRedirects: 5,
              validateStatus: s => s < 400 
            });
            const dest = check.request.res.responseUrl;
            console.log(`   > Result: Redirected to -> ${dest}`);
            
            if (dest.includes('gift_id=')) {
              console.log("   🎉 BINGO! This is a VALID GIFT ID.");
            }
          } catch (e) {
            console.log(`   > Error checking link: ${e.message}`);
          }
        }
      }
    }

  } catch (error) {
    console.error("❌ FATAL ERROR:", error.message);
    if (error.response) {
      console.log("Server Headers:", error.response.headers);
      console.log("Server Data:", JSON.stringify(error.response.data).substring(0, 100));
    }
  }
}

run();