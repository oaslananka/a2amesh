#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

const apiVersion = '2026-03-10';
const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const prNumber = process.env.PR_NUMBER ?? readPullRequestNumber();
const outputPath = process.env.REVIEW_THREAD_SUMMARY_PATH ?? 'review-thread-summary.json';

if (!token) {
  throw new Error('GITHUB_TOKEN is required');
}

if (!repository || !repository.includes('/')) {
  throw new Error('GITHUB_REPOSITORY must be owner/repo');
}

if (!prNumber) {
  writeSummary({
    status: 'skipped',
    reason: 'No pull request number detected',
    unresolved: [],
  });
  process.exit(0);
}

const [owner, repo] = repository.split('/');
const threads = await fetchReviewThreads(owner, repo, Number(prNumber));
const unresolved = threads
  .filter((thread) => !thread.isResolved && !thread.isOutdated)
  .map((thread) => ({
    id: thread.id,
    comments: thread.comments.map((comment) => ({
      author: comment.author?.login ?? 'unknown',
      authorAssociation: comment.authorAssociation,
      url: comment.url,
      actionable: isActionable(comment),
      bodyPreview: String(comment.body ?? '').slice(0, 240),
    })),
  }))
  .filter((thread) => thread.comments.some((comment) => comment.actionable));

writeSummary({
  status: unresolved.length === 0 ? 'clean' : 'blocked',
  pullRequest: Number(prNumber),
  unresolved,
});

if (unresolved.length > 0) {
  throw new Error(`${unresolved.length} actionable review thread(s) remain unresolved`);
}

async function fetchReviewThreads(ownerName, repoName, number) {
  const query = `
  query($owner: String!, $repo: String!, $number: Int!, $after: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            isResolved
            isOutdated
            comments(first: 100) {
              pageInfo { hasNextPage endCursor }
              nodes {
                author { login }
                authorAssociation
                body
                url
              }
            }
          }
        }
      }
    }
  }
`;

  const threads = [];
  let after;
  do {
    const data = await graphql(query, { owner: ownerName, repo: repoName, number, after });
    const page = data.repository.pullRequest.reviewThreads;
    for (const thread of page.nodes) {
      threads.push({
        id: thread.id,
        isResolved: thread.isResolved,
        isOutdated: thread.isOutdated,
        comments: await collectThreadComments(thread),
      });
    }
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : undefined;
  } while (after);
  return threads;
}

async function collectThreadComments(thread) {
  const comments = [...thread.comments.nodes];
  let after = thread.comments.pageInfo.hasNextPage ? thread.comments.pageInfo.endCursor : undefined;
  while (after) {
    const data = await graphql(
      `
        query ($id: ID!, $after: String) {
          node(id: $id) {
            ... on PullRequestReviewThread {
              comments(first: 100, after: $after) {
                pageInfo {
                  hasNextPage
                  endCursor
                }
                nodes {
                  author {
                    login
                  }
                  authorAssociation
                  body
                  url
                }
              }
            }
          }
        }
      `,
      { id: thread.id, after },
    );
    const page = data.node.comments;
    comments.push(...page.nodes);
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : undefined;
  }
  return comments;
}

function readPullRequestNumber() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return undefined;
  try {
    const event = JSON.parse(readFile(eventPath));
    return event.pull_request?.number ?? event.review?.pull_request?.number ?? event.issue?.number;
  } catch {
    return undefined;
  }
}

function readFile(path) {
  return readFileSync(path, 'utf8');
}

function isActionable(comment) {
  const body = String(comment.body ?? '').toLowerCase();
  const association = String(comment.authorAssociation ?? '').toUpperCase();
  if (body.includes('nitpick') || body.includes('informational')) return false;
  if (['OWNER', 'MEMBER', 'COLLABORATOR'].includes(association)) return true;
  return [
    'bug',
    'security',
    'must',
    'required',
    'potential issue',
    'suggested fix',
    'blocking',
    'failing',
    'vulnerability',
  ].some((term) => body.includes(term));
}

async function graphql(queryText, variables) {
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'x-github-api-version': apiVersion,
    },
    body: JSON.stringify({ query: queryText, variables }),
  });
  const payload = await response.json();
  if (!response.ok || payload.errors) {
    throw new Error(JSON.stringify(payload.errors ?? payload));
  }
  return payload.data;
}

function writeSummary(summary) {
  writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
  const lines = [
    '## Review thread gate',
    '',
    `Status: \`${summary.status}\``,
    '',
    `Actionable unresolved threads: \`${summary.unresolved?.length ?? 0}\``,
  ];
  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`, { flag: 'a' });
  }
}
