const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// 1. Setup Connections
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const API_URL = 'https://community-api.hero-wars.com/api/posts/published?page=1';

async function run() {
  console.log("🤖 Scraper Activated...");

  try {
    // 2. Get Data from Hero Wars API
    const response = await axios.get(API_URL);
    // Based on standard API structures, results are usually in 'results' or 'data'
    // We will try to grab the array of posts safely
    const posts = response.data.results || response.data || [];

    console.log(`🔎 Analyzing ${posts.length} posts...`);

    for (const post of posts) {
      const postId = post.id;
      const title = post.title || 'No Title';
      // The API often hides the text in 'preview' or 'data'
      const rawBody = JSON.stringify(post); 
      const postUrl = `https://community.hero-wars.com/post/${postId}`;

      // 3. Check if exists in DB
      const { data: existing } = await supabase
        .from('posts')
        .select('id')
        .eq('id', postId)
        .single();

      if (existing) {
        // If we found it, stop. We assume feeds are ordered, so older posts are already done.
        continue;
      }

      console.log(`✨ New Post Detected: ${postId}`);

      // 4. Save to Database
      await supabase.from('posts').insert({
        id: postId,
        title: title,
        body: rawBody, // Storing raw data for now to be safe
        image_url: post.image_url || null,
        created_at: new Date(post.created_at * 1000 || Date.now()), // APIs often use unix timestamp
        url: postUrl
      });

      // 5. Check for Gifts (Regex search)
      const giftRegex = /https:\/\/herowars\.me\/[a-zA-Z0-9]+/g;
      const foundGifts = rawBody.match(giftRegex);

      if (foundGifts) {
        for (const giftUrl of foundGifts) {
          await supabase.from('gifts').insert({ post_id: postId, gift_url: giftUrl });
          await sendDiscord(`🎁 **GIFT ALERT!**\n${giftUrl}\nSource: ${postUrl}`);
        }
      } else {
        // It's just news
        await sendDiscord(`📰 **News:** ${title}\n${postUrl}`);
      }
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}

async function sendDiscord(text) {
  if (!DISCORD_WEBHOOK) return;
  await axios.post(DISCORD_WEBHOOK, { content: text });
}

run();