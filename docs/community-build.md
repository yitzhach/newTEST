# The community layer — future build

A specification, not a plan of record. Nothing here is built yet.

The intel layer answers *what happened at this show*. The community layer
answers *what should I do about it* — the conversation that currently happens
in Facebook groups, in text threads between four artists who trust each other,
and in the parking lot at load-out on Sunday.

---

## 1. What this is not

**It is not a forum.** Forum software solved a 2004 problem: how do strangers
hold a persistent public conversation. This is a closed network of professional
artists who mostly know each other, talking about a fixed set of ~236 real-world
events on a repeating annual calendar. A category tree and a "General
Discussion" board would be the wrong shape immediately.

**It is not a feed.** No infinite scroll, no engagement ranking, no follower
counts. Those mechanics reward volume and heat, and this network's entire value
proposition is the opposite — signal density and professional restraint. An
artist should be able to open it once a week, see what changed on the shows
they care about, and close it.

**It is not where the drama goes.** The intel layer's conduct standard applies
here unchanged and is, if anything, harder to enforce in conversation than in
structured fields. See §6.

---

## 2. The organising idea: everything hangs off a show

The single design decision this whole layer rests on.

There is no free-floating "General" board. Every thread is anchored to
something concrete that already exists in the system:

| Anchor | Example thread |
|---|---|
| a **show** | "Cherry Creek 2027" |
| a **show + year** | "Naples National 2027 — anyone else waitlisted?" |
| a **weekend** | "Labor Day: Long's Park vs Kings Mountain" |
| a **route** | "I-10 corridor, February" |
| a **discipline** | "Glass: which shows actually give you power" |

Anchoring does three things a forum cannot. It makes discussion
**findable a year later**, when it matters — the artist deciding whether to
apply to Krasl in October wants what was said last July. It lets threads
**surface inside the show drawer** the artist is already reading, rather than
in a separate destination they have to remember to visit. And it gives the
system somewhere to put a thread's conclusions: when a discussion establishes a
fact ("the 2027 jury is being run by a new director"), that fact can be
promoted into the show record with the thread as its provenance.

That last one is the real prize. A conversation that improves the data is worth
more than a conversation that scrolls away.

---

## 3. Architecture

All Cloudflare, continuous with the intel Worker in `worker/`.

```
Browser
  │  WebSocket (live thread)          HTTPS (everything else)
  ▼                                    ▼
Durable Object per thread ─────────► Worker (same router as intel)
  │  presence, typing, live posts       │
  │  hibernates when empty              ├─► D1        threads, posts, membership
  ▼                                     ├─► R2        images, voice notes
D1 (durable write-behind)               ├─► Vectorize semantic search
                                        └─► Workers AI  summarise, draft-check
```

**Durable Objects, one per thread.** A DO gives a single-threaded consistency
domain per conversation: ordering, presence and typing indicators come free,
and WebSocket hibernation means an idle thread costs nothing. Threads are
long-lived but almost always idle, which is exactly the shape hibernation is
for.

**D1 is the durable record.** The DO holds live state and writes through. If a
DO is evicted mid-conversation nothing is lost, because a post is acknowledged
only after the D1 write returns.

**R2 for images and audio**, uploaded direct from the browser via a presigned
URL so files never transit the Worker. Images are the point: artists argue about
booth layout, hanging systems, crating and display walls, and a photograph
settles it faster than four paragraphs.

**Vectorize for search.** Keyword search over art-fair discussion is close to
useless — the artist asking "does anyone know if they'll take framed work behind
glass" needs the thread where someone wrote "they made me pull my plexi pieces."
Embeddings find that; `LIKE '%framed%'` does not.

**Workers AI for two narrow jobs**, both assistive and both refusable:
summarising a long thread into its conclusions, and the drafting check in §6.
No auto-generated posts, no AI participants. A network whose value is other
professionals' judgement does not want synthetic judgement in the room.

---

## 4. Data model

```sql
threads (
  id, anchor_type, anchor_id,        -- 'show' | 'show_year' | 'weekend' | 'route' | 'discipline'
  title, created_by, visibility,     -- inherits the intel tiers, see §5
  status,                            -- 'open' | 'resolved' | 'archived'
  post_count, last_post_at,
  created_at, updated_at, deleted_at
)

posts (
  id, thread_id, author_id, visibility,
  body,                              -- markdown, no embedded HTML
  reply_to,                          -- one level of nesting, deliberately
  created_at, edited_at, deleted_at
)

post_media (id, post_id, r2_key, kind, width, height, bytes, alt_text)

thread_reads (thread_id, member_id, last_read_at)   -- what changed since you looked

-- A thread that established something factual. The bridge back to the data.
thread_findings (
  id, thread_id, show_id, field, value, proposed_by,
  status,                            -- 'proposed' | 'accepted' | 'rejected'
  reviewed_by, reviewed_at
)
```

**One level of nesting.** Deeply threaded replies produce conversations nobody
can follow and everybody re-litigates. One level covers "replying to that
specific point" and stops short of a tree.

**`thread_findings` is the payoff.** A steward promotes a finding, and the show
record gains a fact whose provenance is a named conversation among working
artists — which is a stronger source than anything the editorial pass can
produce, and stronger than most published show information.

---

## 5. Identity

The three tiers carry over from the intel layer without change, because an
artist who has decided how visible they want to be about a show's numbers has
already made the same decision about talking about it.

- **Signed** — your name on the post. The default, and the norm.
- **Anonymous** — visible to members, author withheld. For the times when
  saying the true thing under your name would cost you a booth next year.
- **Private** — a note to yourself on a thread. Never sent to the server, same
  as the intel layer.

Two rules that are not obvious and matter:

**Anonymity is per-post, not per-thread, and it is stable within a thread.** An
anonymous poster gets a per-thread pseudonym so a conversation can follow who
said what without unmasking them. The pseudonym does not persist across
threads — otherwise it becomes an identity anyway, and it becomes de-anonymisable
by correlation.

**Signed posts outrank anonymous ones in the default sort.** Not hidden,
not penalised — ordered. Putting your name to something is the mechanism by
which a professional network stays professional, and the ordering should say so
without needing a rule anyone reads.

---

## 6. Conduct

The intel layer's standard applies verbatim. Conversation needs three things on
top of it, because prose is where restraint is hardest.

**The draft check, at the point of posting.** The same tone review the intel
layer runs, extended with a model pass that catches what regexes cannot: the
paragraph that is technically about a policy but is transparently about a
person. It shows the author what it caught, in their own words, and lets them
post anyway. It never blocks. A network of professionals does not need a
censor; it needs a mirror held up at the moment of writing.

**Naming individuals.** A show director, a jury chair, a promoter — these are
real people and this is a written record. The rule the UI states plainly:
*describe what someone did and what it cost you; do not characterise who they
are.* "The jury results came out three weeks late and I had already booked
flights" is intel. "The director is incompetent" is not, and it is also
actionable in a way that a small network cannot afford.

**Right of reply.** A show that is the subject of a thread should be able to
respond to it. Not a veto and not a takedown route — a single linked response,
clearly marked as coming from the show, visible to the same members who saw the
thread. Shows that engage this way are giving the network free information, and
the network should want that rather than fear it.

**Nothing is auto-removed.** Flags go to a human steward, as in the intel
layer. An automated system that deletes posts about art fairs will eventually
delete the one post that mattered.

---

## 7. Notification

Weekly digest by default. Not real-time push, not a badge count.

The digest is anchored the same way everything else is: *these are the shows you
liked, applied to, or reported on, and this is what changed on them.* A new
report on a show you are waitlisted for. A thread on the weekend you are still
deciding. A deadline inside 21 days on something you liked and never applied to.

Instant notification is available per-thread, opt-in, for the case it actually
serves: a live conversation you are in the middle of.

The reason for the default is the same reason there is no feed. This is a tool
for people whose work is making things, and every notification is an
interruption of that. It should have to earn its way in.

---

## 8. Build order

**Phase 1 — threads, no realtime.** D1 and the existing Worker only. Post,
reply, image upload, anchored threads, read state, the weekly digest. Ships in
a couple of weeks and is genuinely useful on its own; most conversation about a
show in October is not synchronous.

**Phase 2 — realtime.** Durable Objects, WebSockets, presence, typing. Adds the
load-out-on-Sunday case and the live "who else is sitting on this waitlist"
case.

**Phase 3 — search and synthesis.** Vectorize over the thread archive, Workers
AI thread summaries, and `thread_findings` promotion into the show records.
This is where the layer starts paying back into the data rather than just
sitting beside it.

**Phase 4 — the show's own voice.** Right of reply, verified show accounts,
possibly a structured "ask the director" thread type.

Phase 1 is worth building the moment the intel layer has enough members to make
a thread worth reading. Below roughly 20 active artists a community layer is an
empty room, and an empty room is worse than no room.

---

## 9. Open questions

**Does it need to exist at all before the intel layer is full?** A discussion
layer on a database nobody has filled in is a Facebook group with extra steps.
The honest sequencing is intel first, conversation once there is something to
converse about.

**How much history does a new member see?** Everything back to the start is the
simplest rule and probably right — but it means an artist joining in year three
can read three years of candid assessments by people who did not know they
would be reading. Worth deciding deliberately rather than by default.

**What happens when a member leaves?** Their signed posts carry their name. Do
they go anonymous, stay, or vanish? Vanishing breaks conversations. Staying may
not be what a departing member wants. The current lean: signed posts stay
signed, and departure is a status rather than an erasure — but this should be
in the membership terms from day one rather than settled after the first person
asks.

**Does a route-anchored thread work?** Routes are personal — my I-10 February is
not yours. A thread anchored to something no two people define identically may
not cohere. Worth prototyping before committing schema to it.
