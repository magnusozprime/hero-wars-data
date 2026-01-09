const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// 1. Setup Connections
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const API_URL = 'https://community-api.hero-wars.com/api/posts/published?page=1';

// Headers to mimic a real browser
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
};

async function run() {
  console.log("🤖 Scraper v4 (ID Validator) Activated...");

  try {
    // 2. Fetch Feed
    const response = await axios.get(API_URL, { headers: HEADERS });
    const posts = response.data.results || response.data || [];

    for (const post of posts) {
      const postId = post.id;
      const title = post.title || 'No Title';
      const rawBody = JSON.stringify(post);
      const postUrl = `https://community.hero-wars.com/post/${postId}`;

      // 3. Database Check (Prevent Duplicates)
      const { data: existing } = await supabase.from('posts').select('id').eq('id', postId).single();
      if (existing) {
        // We stop here because we assume older posts are already processed
        // Remove 'continue' if you want to re-check old posts for missed gifts
        continue; 
      }

      // 4. Save Post to DB
      await supabase.from('posts').insert({
        id: postId,
        title: title,
        body: rawBody,
        image_url: post.image_url || null,
        created_at: new Date(post.created_at * 1000 || Date.now()),
        url: postUrl
      });

      // 5. Link Discovery
      // We look for herowars.me shortlinks AND direct hero-wars.com links
      const linkRegex = /(https:\/\/herowars\.me\/[a-zA-Z0-9]+)|(https:\/\/www\.hero-wars\.com\/\?[\w=&]+)/g;
      const foundLinks = rawBody.match(linkRegex);

      if (foundLinks) {
        let confirmedGifts = [];

        for (const link of foundLinks) {
          console.log(`🔎 Checking link: ${link}`);
          const result = await validateGiftLink(link);
          
          if (result.isValid) {
            console.log(`✅ CONFIRMED GIFT ID: ${result.giftId}`);
            
            // Save to DB
            await supabase.from('gifts').insert({ 
              post_id: postId, 
              gift_url: result.finalUrl, // Store the long URL with the ID
              is_active: true 
            });
            
            confirmedGifts.push(result.finalUrl);
          } else {
            console.log(`❌ Not a gift link.`);
          }
        }

        // 6. Notification
        if (confirmedGifts.length > 0) {
          const linksText = confirmedGifts.map(l => `<${l}>`).join('\n'); // <> prevents discord embed clutter
          await sendDiscord(`🎁 **NEW GIFT FOUND!**\n${linksText}\n\nSource: ${postUrl}`);
        }
      } else {
        await sendDiscord(`📰 **News:** ${title}\n${postUrl}`);
      }
    }

  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}

// 🕵️‍♂️ The "Gift ID" Validator
async function validateGiftLink(url) {
  try {
    // Follow the redirects to see the final URL
    const response = await axios.get(url, { 
      headers: HEADERS,
      maxRedirects: 5,
      validateStatus: status => status < 400 
    });

    const finalUrl = response.request.res.responseUrl || url; // The destination URL
    
    // THE CHECK: Does it have "gift_id=" ?
    if (finalUrl.includes('gift_id=')) {
      // Extract the ID just for logging
      const idMatch = finalUrl.match(/gift_id=([a-zA-Z0-9]+)/);
      const giftId = idMatch ? idMatch[1] : 'Unknown';
      
      return { isValid: true, finalUrl: finalUrl, giftId: giftId };
    }

    return { isValid: false };

  } catch (e) {
    console.log(`Link check failed: ${e.message}`);
    return { isValid: false };
  }
}

async function sendDiscord(text) {
  if (!DISCORD_WEBHOOK) return;
  try { await axios.post(DISCORD_WEBHOOK, { content: text }); } 
  catch (e) { console.error("Discord Error"); }
}

run();