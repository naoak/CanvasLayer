const express = require('express');
const app = express();
const serveIndex = require('serve-index');
const port = 8000;
app.use('/', express.static(__dirname));
app.use('/', serveIndex(__dirname));
app.listen(port, () => console.log(`Server listening on port ${port}`));
