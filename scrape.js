const axios = require('axios');
// Removed Supabase for this test to isolate the API problem
const API_URL = 'https://community-api.hero-wars.com/api/posts/published?page=1';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://community.hero-wars.com/'
};

async function run() {
  console.log("🚑 CRASH-PROOF DIAGNOSTICS STARTED");

  try {
    console.log("1. Contacting API...");
    const response = await axios.get(API_URL, { headers: HEADERS });

    console.log(`   > Status Code: ${response.status}`);
    console.log(`   > Data Type:   ${typeof response.data}`);
    
    // Check if it is an array (List of posts)
    if (Array.isArray(response.data)) {
      console.log("   > Structure:   It is a pure Array.");
      processPosts(response.data);
    } 
    // Check if it is an object (Like { results: [...] } or { error: "..." })
    else if (typeof response.data === 'object') {
      console.log(`   > Structure:   It is an Object with keys: [${Object.keys(response.data).join(', ')}]`);
      
      if (response.data.results) {
        console.log("   > Found 'results' key. Using that.");
        processPosts(response.data.results);
      } else if (response.data.data) {
        console.log("   > Found 'data' key. Using that.");
        processPosts(response.data.data);
      } else {
        console.log("❌ ERROR: The API returned an object, but no 'results' or 'data' list found.");
        console.log("   > RAW RESPONSE DUMP:", JSON.stringify(response.data, null, 2));
      }
    } else {
      console.log("❌ ERROR: Unknown data format (String/HTML?).");
      console.log("   > DUMP:", response.data.toString().substring(0, 200));
    }

  } catch (error) {
    console.error("❌ HTTP REQUEST FAILED:", error.message);
    if (error.response) {
      console.log("   > Status:", error.response.status);
      console.log("   > Data:", JSON.stringify(error.response.data));
    }
  }
}

function processPosts(posts) {
  if (!Array.isArray(posts)) {
    console.log("❌ ERROR: 'posts' is still not an array. It is:", typeof posts);
    return;
  }
  
  console.log(`✅ SUCCESS: Found ${posts.length} posts.`);
  const firstPost = posts[0];
  if(firstPost) {
     console.log(`   > Sample Post ID: ${firstPost.id}`);
     console.log(`   > Sample Title:   ${firstPost.title}`);
     
     // Quick Regex Check on the first post
     const raw = JSON.stringify(firstPost);
     const links = raw.match(/https?:\/\/[^\s"']+/g) || [];
     console.log(`   > Links found in sample: ${links.length}`);
     if(links.length > 0) console.log(`   > Examples: ${links.slice(0, 2).join(', ')}`);
  }
}

run();