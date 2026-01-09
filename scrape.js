const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// 1. Setup Connections
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const API_URL = 'https://community-api.hero-wars.com/api/posts/published?page=1';

// Headers
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
};

async function run() {
  console.log("🤖 Universal Scraper (Repair Mode) Activated...");

  try {
    const response = await axios.get(API_URL, { headers: HEADERS });
    const posts = response.data.results || response.data || [];

    console.log(`🔎 Feed fetched. Analyzing ${posts.length} posts...`);

    for (const post of posts) {
      const postId = post.id;
      // CLEANUP: We convert to string AND remove backslashes to fix broken links (https:\/\/ -> https://)
      const rawBody = JSON.stringify(post).replace(/\\/g, ''); 
      const postUrl = `https://community.hero-wars.com/post/${postId}`;

      // --- DB CHECK DISABLED FOR TESTING ---
      // We want to force it to re-check posts to confirm the bit.ly logic works
      // const { data: existing } = await supabase.from('posts').select('id').eq('id', postId).single();
      // if (existing) { continue; } 
      // -------------------------------------

      // 5. Link Discovery
      // Matches: http or https, optional www, then the domain, then the rest of the link
      const linkRegex = /https?:\/\/(?:www\.)?(herowars\.me|hero-wars\.com|bit\.ly|tinyurl\.com|goo\.gl)\/[a-zA-Z0-9\?\=\&\-\_]+/g;
      
      const foundLinks = rawBody.match(linkRegex);

      if (foundLinks) {
        // Remove duplicates found in the same post
        const uniqueLinks = [...new Set(foundLinks)];
        
        console.log(`   ➡ Found potential links in post ${postId}: ${uniqueLinks.join(', ')}`);

        let confirmedGifts = [];

        for (const link of uniqueLinks) {
          const result = await validateGiftLink(link);
          
          if (result.isValid) {
            console.log(`   ✅ CONFIRMED GIFT: ${result.giftId}`);
            
            // Check if we already sent this SPECIFIC gift to DB (to avoid Discord spam on re-runs)
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
            } else {
              console.log(`      (Gift already in DB, skipping Discord alert)`);
            }
          }
        }

        // 6. Notification
        if (confirmedGifts.length > 0) {
          console.log("   🚀 Sending to Discord...");
          const linksText = confirmedGifts.map(l => `[Click to Claim](${l})`).join('\n');
          const embed = {
            title: "🎁 New Gift Detected!",
            description: `${linksText}\n\n[View Original Post](${postUrl})`,
            color: 5763719,
            footer: { text: "Hero Wars Data Hub" }
          };
          await sendDiscord(embed);
        }
      }
      
      // Upsert the post (Insert or Update if exists) to ensure we have the record
      await supabase.from('posts').upsert({
        id: postId,
        title: post.title || 'No Title',
        body: rawBody,
        image_url: post.image_url || null,
        created_at: new Date(post.created_at * 1000 || Date.now()),
        url: postUrl
      });
    }

  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}

async function validateGiftLink(url) {
  try {
    // console.log(`      Testing: ${url}`); // Uncomment for deep debug
    const response = await axios.get(url, { 
      headers: HEADERS,
      maxRedirects: 5, 
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
    // console.log(`      Link failed: ${e.message}`);
    return { isValid: false };
  }
}

async function sendDiscord(embed) {
  if (!DISCORD_WEBHOOK) return;
  try { await axios.post(DISCORD_WEBHOOK, { embeds: [embed] }); } 
  catch (e) { console.error("Discord Error"); }
}

run();