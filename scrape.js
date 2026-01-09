const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// 1. Setup Connections
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const API_URL = 'https://community-api.hero-wars.com/api/posts/published?page=1';

// HEADERS: This makes us look like a real Chrome browser so we don't get blocked
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://community.hero-wars.com/',
  'Origin': 'https://community.hero-wars.com'
};

async function run() {
  console.log("🤖 Scraper v2 Activated...");

  try {
    // 2. Get Data from Hero Wars API with Headers
    console.log("Connecting to Hero Wars...");
    const response = await axios.get(API_URL, { headers: HEADERS });
    
    // Debugging: Print what the data looks like
    // This helps us see if the API structure changed
    const data = response.data;
    const posts = data.results || data.data || data; 

    console.log(`🔎 Server Response Type: ${typeof data}`);
    console.log(`🔎 Found ${posts.length} items.`);

    if (!posts || posts.length === 0) {
      console.log("⚠️ Warning: API returned 0 posts. Check API URL or response format.");
      return;
    }

    for (const post of posts) {
      const postId = post.id;
      const title = post.title || 'No Title';
      const rawBody = JSON.stringify(post); 
      const postUrl = `https://community.hero-wars.com/post/${postId}`;

      // 3. Check if exists in DB
      const { data: existing, error: dbError } = await supabase
        .from('posts')
        .select('id')
        .eq('id', postId)
        .single();
      
      if (dbError && dbError.code !== 'PGRST116') { // PGRST116 is "not found", which is good
         console.log(`⚠️ DB Check Error: ${dbError.message}`);
      }

      if (existing) {
        console.log(`- Post ${postId} already exists.`);
        continue; 
      }

      console.log(`✨ INSERTING Post: ${postId}`);

      // 4. Save to Database
      const { error: insertError } = await supabase.from('posts').insert({
        id: postId,
        title: title,
        body: rawBody, 
        image_url: post.image_url || null,
        created_at: new Date(post.created_at * 1000 || Date.now()), 
        url: postUrl
      });

      if (insertError) {
        console.error(`❌ DB Insert Error: ${insertError.message}`);
        continue;
      }

      // 5. Check for Gifts
      const giftRegex = /https:\/\/herowars\.me\/[a-zA-Z0-9]+/g;
      const foundGifts = rawBody.match(giftRegex);

      if (foundGifts) {
        for (const giftUrl of foundGifts) {
          await supabase.from('gifts').insert({ post_id: postId, gift_url: giftUrl });
          console.log(`🎁 Gift Found: ${giftUrl}`);
          await sendDiscord(`🎁 **GIFT ALERT!**\n${giftUrl}\nSource: ${postUrl}`);
        }
      } else {
        await sendDiscord(`📰 **News:** ${title}\n${postUrl}`);
      }
    }
  } catch (error) {
    console.error("❌ CRITICAL ERROR:", error.message);
    if (error.response) {
      console.error("Server Respanse:", error.response.status, error.response.statusText);
    }
  }
}

async function sendDiscord(text) {
  if (!DISCORD_WEBHOOK) {
    console.log("No Discord Webhook set.");
    return;
  }
  try {
    await axios.post(DISCORD_WEBHOOK, { content: text });
  } catch (e) {
    console.error("Discord Error:", e.message);
  }
}

run();