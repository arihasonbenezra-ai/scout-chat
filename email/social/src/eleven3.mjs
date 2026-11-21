import fs from 'fs';
const key = fs.readFileSync(process.env.HOME+'/.config/ezzy/elevenlabs.key','utf8').trim();
const [,, voiceId, outBase] = process.argv;
const LINES = ['[warm] Hey. Meet Ezzy.', "[friendly] It's your career coach... built by recruiters and hiring managers. People who've actually done the hiring.", 'It reads your resume,', 'tells you where you fit,', 'and gets you ready for the interview.', "[gently] And here's the thing. It never guesses. Everything it says comes from your resume, your answers, or a source.", '[upbeat] Try it free. meet ezzy dot com.'];
const SEP = ['  ', '  ', ' ', ' ', '  ', '  '];
let text='', starts=[];
LINES.forEach((l,i)=>{ const body = l.replace(/^\[[^\]]*\]\s*/,''); starts.push(text.length + (l.length - body.length)); text += l + (SEP[i]||''); });
const body = { text, model_id:'eleven_v3', voice_settings:{ stability:0.5, similarity_boost:0.8, use_speaker_boost:true } };
let r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`, { method:'POST', headers:{'xi-api-key':key,'Content-Type':'application/json'}, body: JSON.stringify(body) });
if (r.ok) {
  const d = await r.json();
  fs.writeFileSync(outBase+'.mp3', Buffer.from(d.audio_base64,'base64'));
  const al = d.alignment || d.normalized_alignment; const chars = al.characters, st = al.character_start_times_seconds, en = al.character_end_times_seconds;
  // normalized alignment may not be 1:1 with text when tags are stripped; locate each line body in the aligned string
  const aligned = chars.join('');
  let cues=[], from=0;
  for (const l of LINES){ const b=l.replace(/^\[[^\]]*\]\s*/,''); const probe=b.slice(0,12); let k=aligned.indexOf(probe, from); if(k<0){ k=aligned.toLowerCase().indexOf(probe.toLowerCase(), from); } if(k<0){ cues.push(null); continue; } cues.push(+st[k].toFixed(3)); from=k+probe.length; }
  const end = +en[en.length-1].toFixed(3);
  fs.writeFileSync(outBase+'.json', JSON.stringify({ cues, end, lines: LINES, via:'timestamps' }));
  console.log('cues', JSON.stringify(cues), 'end', end, '(timestamps)');
} else {
  const err = await r.text(); console.error('with-timestamps refused', r.status, err.slice(0,200));
  r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, { method:'POST', headers:{'xi-api-key':key,'Content-Type':'application/json'}, body: JSON.stringify(body) });
  if(!r.ok){ console.error('tts failed', r.status, (await r.text()).slice(0,300)); process.exit(1); }
  fs.writeFileSync(outBase+'.mp3', Buffer.from(await r.arrayBuffer()));
  fs.writeFileSync(outBase+'.json', JSON.stringify({ cues:null, lines: LINES, via:'plain' }));
  console.log('plain audio saved; cues to be derived from silences');
}
