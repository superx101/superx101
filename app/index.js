const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const css = require('css');
const { Liquid } = require('liquidjs');
const chokidar = require('chokidar');
const express = require('express');
const markdownIt = require('markdown-it')({
  html: true,
  xhtmlOut: true,
  breaks: true,
  linkify: true
});

const app = express();
const port = 3000;
const engine = new Liquid();

let currentContent = '';
let clients = [];

function removeEmptyLines(str) {
  return str.replace(/^\s*[\r\n]/gm, '');
}

function parseCss(content) {
  const parsed = css.parse(content);
  const styles = {};

  parsed.stylesheet.rules.forEach(rule => {
    if (rule.type !== "rule") return;
    rule.selectors.forEach(selector => {
      const styleStr = rule.declarations
      .map(decl => `${decl.property}: ${decl.value};`)
      .join(' ');

      styles[selector] = styles[selector] 
        ? `${styles[selector]} ${styleStr}`
        : styleStr;
    });
  });

  return styles;
}

function renderMarkdown() {
  try {
    const data = yaml.load(fs.readFileSync('data.yml', 'utf8'));
    const template = fs.readFileSync('template.liquid', 'utf8');
    const stylesString = fs.readFileSync('style.css', 'utf8');
    data.styles = parseCss(stylesString);

    engine.parseAndRender(template, data)
      .then((content) => {
        content = removeEmptyLines(content);
        currentContent = content;
        fs.writeFileSync('dist.md', content);
        console.log('✅ dist updated');

        // Notify all connected clients
        const htmlContent = processContent(content);
        clients.forEach(client => {
          client.res.write(`data: ${JSON.stringify({ html: htmlContent })}\n\n`);
        });
      })
      .catch((err) => {
        console.error('❌ Render failed:', err);
      });
  } catch (err) {
    console.error('❌ File read error:', err);
  }
};

function processContent(content) {
  return markdownIt.render(
    content.replace(/<html>([\s\S]*?)<\/html>/g, '<div class="html-section">$1</div>')
  );
  // return content;
};

const watcher = chokidar.watch(['data.yml', 'template.liquid', 'style.css'], {
  persistent: true,
  ignoreInitial: true,
});

watcher
  .on('add', (path) => console.log(`📁 Watching: ${path}`))
  .on('change', (path) => {
    console.log(`🔄 File changed: ${path}`);
    renderMarkdown();
  })
  .on('error', (err) => console.error('❌ Watch error:', err));

// Serve static files
app.use('/github-markdown-css', express.static(path.dirname(require.resolve('github-markdown-css'))));

// SSE endpoint for updates
app.get('/updates', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const clientId = Date.now();
  const newClient = {
    id: clientId,
    res
  };
  clients.push(newClient);

  // Send initial content
  res.write(`data: ${JSON.stringify({ html: processContent(currentContent) })}\n\n`);

  req.on('close', () => {
    clients = clients.filter(c => c.id !== clientId);
  });
});

// Main page
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Markdown Preview</title>
      <link rel="stylesheet" href="/github-markdown-css/github-markdown.min.css">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        .markdown-body {
            box-sizing: border-box;
            min-width: 200px;
            max-width: 980px;
            margin: 0 auto;
            padding: 45px;
        }

        @media (max-width: 767px) {
            .markdown-body {
                padding: 15px;
            }
        }
      </style>
    </head>
    <body>
      <article class="markdown-body" id="content">
        ${processContent(currentContent)}
      </article>
      <script>
        const eventSource = new EventSource('/updates');
        eventSource.onmessage = (e) => {
          const data = JSON.parse(e.data);
          document.getElementById('content').innerHTML = data.html;
        };
      </script>
    </body>
    </html>
  `);
});

app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
  console.log('👀 Watching for file changes...');
  renderMarkdown();
});