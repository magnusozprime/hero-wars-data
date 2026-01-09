const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// 1. Setup Connections
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const API_URL = 'https://community-api.hero-wars.com/api/posts/published?page=1';

// Headers to mimic a real Chrome Browser (Prevents blocking)
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
};

async function run() {
  console.log("🤖 Hero Wars Scraper: ONLINE");

  try {
    // 2. Fetch Feed
    const response = await axios.get(API_URL, { headers: HEADERS });
    // Handle different data structures safely
    const posts = response.data.results || response.data.data || response.data || [];

    console.log(`🔎 Scanning ${posts.length} posts...`);

    for (const post of posts) {
      const postId = post.id;
      // Clean up the data (Fix broken slashes in links)
      const rawBody = JSON.stringify(post).replace(/\\/g, ''); 
      const postUrl = `https://community.hero-wars.com/post/${postId}`;

      // 3. Database Check (Prevent Duplicates)
      const { data: existing } = await supabase.from('posts').select('id').eq('id', postId).single();
      
      if (existing) {
        // Post is already in DB. Skip it to prevent spam.
        // (Since you deleted your DB, this will return false, and the code will run!)
        continue; 
      }

      console.log(`✨ New Post Found: ${postId}`);

      // 4. Save Post to DB
      await supabase.from('posts').insert({
        id: postId,
        title: post.title || 'No Title',
        body: rawBody,
        image_url: post.image_url || null,
        created_at: new Date(post.created_at * 1000 || Date.now()),
        url: postUrl
      });

      // 5. Link Discovery
      // Finds: herowars.me, hero-wars.com, bit.ly, tinyurl, goo.gl
      const linkRegex = /https?:\/\/(?:www\.)?(herowars\.me|hero-wars\.com|bit\.ly|tinyurl\.com|goo\.gl)\/[a-zA-Z0-9\?\=\&\-\_]+/g;
      const foundLinks = rawBody.match(linkRegex);

      if (foundLinks) {
        // Remove duplicates within the same post
        const uniqueLinks = [...new Set(foundLinks)];
        let confirmedGifts = [];

        for (const link of uniqueLinks) {
          // Validate the link (Check if it redirects to a Gift ID)
          const result = await validateGiftLink(link);
          
          if (result.isValid) {
            console.log(`✅ GIFT CONFIRMED: ${result.giftId}`);
            
            // Double check: Have we posted this specific gift link before?
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

        // 6. Send Discord Notification
        if (confirmedGifts.length > 0) {
          const linksText = confirmedGifts.map(l => `[Click To Claim Gift](${l})`).join('\n');
          
          const embed = {
            title: "🎁 New Gift Detected!",
            description: `${linksText}\n\n[View Original Post](${postUrl})`,
            color: 5763719, // Green
            footer: { text: "Hero Wars Data Hub" },
            timestamp: new Date().toISOString()
          };

          await sendDiscord(embed);
        }
      }
    }

  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}

// 🕵️‍♂️ Validator: Follows redirects (bit.ly) and checks for 'gift_id'
async function validateGiftLink(url) {
  try {
    const response = await axios.get(url, { 
      headers: HEADERS,
      maxRedirects: 5, 
      validateStatus: status => status < 400 
    });

    const finalUrl = response.request.res.responseUrl || url;
    
    // THE CHECK: Does it have "gift_id=" ?
    if (finalUrl.includes('gift_id=')) {
      const idMatch = finalUrl.match(/gift_id=([a-zA-Z0-9]+)/);
      const giftId = idMatch ? idMatch[1] : 'Unknown';
      return { isValid: true, finalUrl: finalUrl, giftId: giftId };
    }

    return { isValid: false };

  } catch (e) {
    return { isValid: false };
  }
}

async function sendDiscord(embed) {
  if (!DISCORD_WEBHOOK) return;
  try { await axios.post(DISCORD_WEBHOOK, { embeds: [embed] }); } 
  catch (e) { console.error("Discord Error"); }
}

run();