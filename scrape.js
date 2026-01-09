const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// 1. Setup Connections
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const API_URL = 'https://community-api.hero-wars.com/api/posts/published?page=1';

// 2. High-Quality Browser Headers (Essential for redirection)
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Referer': 'https://community.hero-wars.com/',
  'Accept-Language': 'en-US,en;q=0.9'
};

async function run() {
  console.log("🤖 Scraper V5: Auto-Fix Mode");

  try {
    // 3. Fetch Feed Safely
    const response = await axios.get(API_URL, { headers: HEADERS });
    
    // FIX THE CRASH: Safely detect where the list of posts is
    let posts = [];
    if (Array.isArray(response.data)) {
      posts = response.data;
    } else if (response.data.results) {
      posts = response.data.results;
    } else if (response.data.data) {
      posts = response.data.data;
    }

    console.log(`🔎 Feed scanned. Found ${posts.length} posts.`);

    for (const post of posts) {
      const postId = post.id;
      // Clean up JSON formatting
      const rawBody = JSON.stringify(post).replace(/\\/g, ''); 
      const postUrl = `https://community.hero-wars.com/post/${postId}`;

      // 4. Upsert Post (Save news to DB immediately)
      await supabase.from('posts').upsert({
        id: postId,
        title: post.title || 'No Title',
        body: rawBody,
        image_url: post.image_url || null,
        created_at: new Date(post.created_at * 1000 || Date.now()),
        url: postUrl
      });

      // 5. Find Links (Broad Search)
      const linkRegex = /https?:\/\/(?:www\.)?(herowars\.me|hero-wars\.com|bit\.ly|tinyurl\.com|goo\.gl)\/[a-zA-Z0-9\?\=\&\-\_]+/g;
      const foundLinks = rawBody.match(linkRegex);

      if (foundLinks) {
        const uniqueLinks = [...new Set(foundLinks)];
        console.log(`   ➡ Post ${postId} has links: ${uniqueLinks.join(', ')}`);

        let confirmedGifts = [];

        for (const link of uniqueLinks) {
          // 6. Validate the Link
          const result = await validateGiftLink(link);
          
          if (result.isValid) {
            console.log(`      ✅ VALID GIFT CONFIRMED: ${result.giftId}`);
            
            // Check DB to see if we already sent this specific gift
            const { data: giftExists } = await supabase
              .from('gifts')
              .select('id')
              .eq('gift_url', result.finalUrl)
              .single();

            if (!giftExists) {
              // Insert into DB
              await supabase.from('gifts').insert({ 
                post_id: postId, 
                gift_url: result.finalUrl, 
                is_active: true 
              });
              confirmedGifts.push(result.finalUrl);
            } else {
              console.log(`      (Gift already in DB)`);
            }
          } else {
            console.log(`      ❌ Link rejected (Not a gift): ${result.finalUrl}`);
          }
        }

        // 7. Send to Discord
        if (confirmedGifts.length > 0) {
          console.log("   🚀 Sending notification to Discord...");
          const linksText = confirmedGifts.map(l => `[👉 Click to Claim Gift](${l})`).join('\n');
          
          const embed = {
            title: "🎁 New Gift Detected!",
            description: `${linksText}\n\n[Source](${postUrl})`,
            color: 5763719,
            footer: { text: "Hero Wars Hub" },
            timestamp: new Date().toISOString()
          };

          await sendDiscord(embed);
        }
      }
    }

  } catch (error) {
    console.error("❌ CRITICAL ERROR:", error.message);
  }
}

// 🕵️‍♂️ Validator
async function validateGiftLink(url) {
  try {
    // Follow the link to see where it lands
    const response = await axios.get(url, { 
      headers: HEADERS,
      maxRedirects: 5, 
      validateStatus: status => status < 400 
    });

    const finalUrl = response.request.res.responseUrl || url;
    
    // LOGIC: It must be a hero-wars.com link AND contain "gift_id="
    if (finalUrl.includes('gift_id=')) {
      const idMatch = finalUrl.match(/gift_id=([a-zA-Z0-9]+)/);
      const giftId = idMatch ? idMatch[1] : 'Unknown';
      return { isValid: true, finalUrl: finalUrl, giftId: giftId };
    }

    return { isValid: false, finalUrl: finalUrl };

  } catch (e) {
    console.log(`      ⚠️ Link validation failed for ${url}: ${e.message}`);
    return { isValid: false, finalUrl: url };
  }
}

async function sendDiscord(embed) {
  if (!DISCORD_WEBHOOK) return;
  try { await axios.post(DISCORD_WEBHOOK, { embeds: [embed] }); } 
  catch (e) { console.error("Discord Error:", e.message); }
}

run();