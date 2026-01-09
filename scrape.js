const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// 1. Setup Connections
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const API_URL = 'https://community-api.hero-wars.com/api/posts/published?page=1';

// 2. Browser Headers (Updated to look like a modern Mac Chrome)
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1'
};

async function run() {
  console.log("🤖 Scraper V6: URL Cleaner Mode");

  try {
    const response = await axios.get(API_URL, { headers: HEADERS, timeout: 10000 });
    
    // Safely get posts
    let posts = [];
    if (Array.isArray(response.data)) posts = response.data;
    else if (response.data.results) posts = response.data.results;
    else if (response.data.data) posts = response.data.data;

    console.log(`🔎 Scanning ${posts.length} posts...`);

    for (const post of posts) {
      const postId = post.id;
      
      // --- CRITICAL FIX: CLEAN THE DATA ---
      // 1. Convert JSON to string
      // 2. Remove backslashes (\)
      // 3. Fix HTML entities (&amp; -> &)
      const rawBody = JSON.stringify(post)
        .replace(/\\/g, '')
        .replace(/&amp;/g, '&'); 
        
      const postUrl = `https://community.hero-wars.com/post/${postId}`;

      // Upsert Post to DB
      await supabase.from('posts').upsert({
        id: postId,
        title: post.title || 'No Title',
        body: rawBody,
        image_url: post.image_url || null,
        created_at: new Date(post.created_at * 1000 || Date.now()),
        url: postUrl
      });

      // Find Links
      const linkRegex = /https?:\/\/(?:www\.)?(herowars\.me|hero-wars\.com|bit\.ly|tinyurl\.com|goo\.gl)\/[a-zA-Z0-9\?\=\&\-\_\.]+/g;
      const foundLinks = rawBody.match(linkRegex);

      if (foundLinks) {
        const uniqueLinks = [...new Set(foundLinks)];
        
        let confirmedGifts = [];

        for (const link of uniqueLinks) {
          // Skip obviously bad links (like box.com or images)
          if (link.includes('box.com') || link.includes('.jpg') || link.includes('.png')) continue;

          // Validate
          const result = await validateGiftLink(link);
          
          if (result.isValid) {
            console.log(`      ✅ GIFT CONFIRMED: ${result.giftId}`);
            
            // DB Check
            const { data: giftExists } = await supabase
              .from('gifts')
              .select('id')
              .eq('gift_url', result.finalUrl)
              .single();

            if (!giftExists) {
              await supabase.from('gifts').insert({ 
                post_id: postId, 
                gift_url: result.finalUrl, 
                is_active: true 
              });
              confirmedGifts.push(result.finalUrl);
            }
          }
        }

        // Send to Discord
        if (confirmedGifts.length > 0) {
          console.log("   🚀 Sending to Discord...");
          const linksText = confirmedGifts.map(l => `[👉 Click to Claim Gift](${l})`).join('\n');
          
          const embed = {
            title: "🎁 New Gift Detected!",
            description: `${linksText}\n\n[Source Post](${postUrl})`,
            color: 5763719,
            footer: { text: "Hero Wars Hub" },
            timestamp: new Date().toISOString()
          };

          await sendDiscord(embed);
        }
      }
    }

  } catch (error) {
    console.error("❌ ERROR:", error.message);
  }
}

async function validateGiftLink(url) {
  // Optimization: If the URL *already* has gift_id, don't waste time checking network
  if (url.includes('gift_id=')) {
     const idMatch = url.match(/gift_id=([a-zA-Z0-9]+)/);
     return { isValid: true, finalUrl: url, giftId: idMatch ? idMatch[1] : 'Unknown' };
  }

  try {
    // console.log(`      Testing: ${url}`); // Debug
    const response = await axios.get(url, { 
      headers: HEADERS,
      maxRedirects: 5,
      timeout: 15000, // Wait up to 15 seconds (Fixes ETIMEDOUT)
      validateStatus: status => status < 400 
    });

    const finalUrl = response.request.res.responseUrl || url;
    
    if (finalUrl.includes('gift_id=')) {
      const idMatch = finalUrl.match(/gift_id=([a-zA-Z0-9]+)/);
      const giftId = idMatch ? idMatch[1] : 'Unknown';
      return { isValid: true, finalUrl: finalUrl, giftId: giftId };
    }

    return { isValid: false };

  } catch (e) {
    // console.log(`      Failed: ${e.message}`);
    return { isValid: false };
  }
}

async function sendDiscord(embed) {
  if (!DISCORD_WEBHOOK) return;
  try { await axios.post(DISCORD_WEBHOOK, { embeds: [embed] }); } 
  catch (e) { console.error("Discord Error"); }
}

run();