import { beforeAll, describe, expect, it } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import CatCard from '../src/components/CatCard.astro';
import LikeButton from '../src/components/LikeButton.astro';
import Sentinel from '../src/components/Sentinel.astro';
import CommentForm from '../src/components/CommentForm.astro';
import CommentList from '../src/components/CommentList.astro';
import CommentItem from '../src/components/CommentItem.astro';
import CatModal from '../src/components/CatModal.astro';
import Hero from '../src/components/Hero.astro';
import Leaderboard from '../src/components/Leaderboard.astro';
import Index from '../src/pages/index.astro';
import type { Cat, Comment } from '../src/db/schema';
import { applyMigrations } from './helpers';

const cat: Cat = {
  id: 1,
  name: 'Test Cat',
  thumbnailPath: '/uploads/x_thumb.webp',
  imagePath: '/uploads/x_full.webp',
  likesCount: 5,
  createdAt: '2024-01-01 00:00:00',
};

const comment: Comment = {
  id: 1,
  catId: 1,
  userToken: 'u1',
  text: 'nice cat',
  createdAt: '2024-01-01 00:00:00',
};

let container: Awaited<ReturnType<typeof AstroContainer.create>>;

beforeAll(async () => {
  applyMigrations();
  container = await AstroContainer.create();
});

async function render(component: unknown, props: Record<string, unknown> = {}) {
  return container.renderToString(component as never, { props });
}

describe('CatCard', () => {
  it('links to the detail route and shows the like count', async () => {
    const html = await render(CatCard, { cat });
    expect(html).toContain('hx-get="/api/cats/1"');
    expect(html).toContain('5 ★');
  });
});

describe('LikeButton', () => {
  it('posts to the like route with an outerHTML swap', async () => {
    const html = await render(LikeButton, { cat, liked: false });
    expect(html).toContain('hx-post="/api/cats/1/like"');
    expect(html).toContain('hx-swap="outerHTML"');
  });
});

describe('Sentinel', () => {
  it('reveals and swaps afterend at the given URL', async () => {
    const html = await render(Sentinel, { url: '/api/cats?page=2' });
    expect(html).toContain('hx-get="/api/cats?page=2"');
    expect(html).toContain('hx-trigger="revealed"');
    expect(html).toContain('hx-swap="afterend"');
  });
});

describe('CommentForm', () => {
  it('targets #comment-list with an innerHTML swap', async () => {
    const html = await render(CommentForm, { catId: 1 });
    expect(html).toContain('hx-post="/api/cats/1/comments"');
    expect(html).toContain('hx-target="#comment-list"');
    expect(html).toContain('hx-swap="innerHTML"');
  });
});

describe('CommentList', () => {
  it('renders items and a sentinel but no comment-list wrapper id', async () => {
    const html = await render(CommentList, { comments: [comment], catId: 1, nextPage: 2 });
    expect(html).toContain('nice cat');
    expect(html).toContain('hx-trigger="revealed"');
    expect(html).not.toContain('id="comment-list"');
  });
});

describe('CatModal', () => {
  it('renders exactly one comment-list and one comment-form', async () => {
    const html = await render(CatModal, {
      cat,
      liked: false,
      comments: [comment],
      nextPage: null,
      canComment: true,
    });
    expect(html.match(/id="comment-list"/g)).toHaveLength(1);
    expect(html.match(/id="comment-form"/g)).toHaveLength(1);
  });
});

describe('escaping (CONTRACTS §7 defense-in-depth)', () => {
  const malicious: Cat = { ...cat, name: '<script>alert(1)</script>' };
  const maliciousComment: Comment = { ...comment, text: '<script>alert(1)</script>' };

  it('escapes text nodes and strips tags from alt attributes', async () => {
    // Every component renders the name as text (Astro-escaped to &lt;script&gt;)
    // and as an alt attribute (tag-stripped), so raw <script> never appears.
    const hero = await render(Hero, { cat: malicious });
    expect(hero).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(hero).not.toContain('<script>alert(1)</script>');

    const card = await render(CatCard, { cat: malicious });
    expect(card).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(card).not.toContain('<script>alert(1)</script>');

    const modal = await render(CatModal, {
      cat: malicious,
      liked: false,
      comments: [],
      nextPage: null,
      canComment: true,
    });
    expect(modal).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(modal).not.toContain('<script>alert(1)</script>');

    const board = await render(Leaderboard, { cats: [malicious] });
    expect(board).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(board).not.toContain('<script>alert(1)</script>');

    const item = await render(CommentItem, { comment: maliciousComment });
    expect(item).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(item).not.toContain('<script>alert(1)</script>');
  });

  it('escapes quote breakout in the alt attribute', async () => {
    const quotePayload: Cat = { ...cat, name: '" onerror="alert(1)' };
    const html = await render(CatCard, { cat: quotePayload });
    expect(html).not.toContain('onerror="alert(1)');
    expect(html).toContain('&#34;');
  });
});

describe('index.astro shell', () => {
  it('renders the required ids and the SRI-pinned htmx script', async () => {
    const html = await render(Index, {});
    for (const id of [
      'id="modal"',
      'id="modal-body"',
      'id="cat-grid"',
      'id="sidebar"',
      'id="sidebar-toggle"',
      'id="sidebar-backdrop"',
    ]) {
      expect(html).toContain(id);
    }
    expect(html).toContain('src="/htmx.min.js"');
    expect(html).toContain('integrity="sha384-');
  });
});
