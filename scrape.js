const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const API_URL = 'https://community-api.hero-wars.com/api/posts/published?page=1';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1'
};

async function run() {
  console.log("🕵️‍♂️ DIAGNOSTIC MODE STARTED");

  try {
    const response = await axios.get(API_URL, { headers: HEADERS });
    // Get top 5 posts only for testing
    const posts = (response.data.results || response.data || []).slice(0, 5);

    console.log(`🔎 Analyzing newest ${posts.length} posts...`);

    for (const post of posts) {
      console.log(`\n📘 Post ID: ${post.id}`);
      
      const rawBody = JSON.stringify(post).replace(/\\/g, ''); 
      
      // Regex to find ANY link starting with herowars.me or bit.ly
      const linkRegex = /https?:\/\/(?:www\.)?(herowars\.me|hero-wars\.com|bit\.ly|tinyurl\.com|goo\.gl)\/[a-zA-Z0-9\?\=\&\-\_]+/g;
      const foundLinks = rawBody.match(linkRegex);

      if (!foundLinks) {
        console.log("   (No game links found in this post)");
        continue;
      }

      for (const link of [...new Set(foundLinks)]) {
        console.log(`   ❓ Testing Link: ${link}`);
        
        try {
          const check = await axios.get(link, { 
            headers: HEADERS, 
            maxRedirects: 10,
            validateStatus: s => true // Don't throw error on 403/404/500
          });

          const finalUrl = check.request.res.responseUrl || link;
          console.log(`      > Status Code: ${check.status}`);
          console.log(`      > Landed at:   ${finalUrl}`);

          // Check 1: Is it the game URL?
          if (finalUrl.includes('hero-wars.com')) {
             console.log("      > ✅ Domain is correct.");
          } else {
             console.log("      > ❌ Did not redirect to hero-wars.com. (Blocked?)");
          }

          // Check 2: Does it have gift_id?
          if (finalUrl.includes('gift_id=')) {
            console.log("      > 🎉 GIFT ID FOUND! This link works.");
          } else {
            console.log("      > ❌ No 'gift_id' found in URL.");
            // If it failed, print a snippet of the HTML to see if there is a 'Click Here' button
            // This detects if we are stuck on a landing page
            const htmlSnippet = typeof check.data === 'string' ? check.data.substring(0, 100) : "Binary Data";
            console.log(`      > HTML Dump: ${htmlSnippet.replace(/\n/g, ' ')}`);
          }

        } catch (err) {
          console.log(`      > CRASH: ${err.message}`);
        }
      }
    }

  } catch (error) {
    console.error("❌ Fatal Error:", error.message);
  }
}

run();