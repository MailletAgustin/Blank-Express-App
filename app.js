// Init a simple server with ejs config
const express = require('express');
const app = express();
const {port, domain} = require('./config');
const registerRoute = require('./routes/register');
const handwritingRoute = require('./routes/handwriting');

// Set the view engine to ejs
app.set('view engine', 'ejs');
app.set('views', './views');

// Static files
app.use(express.static('public'));
app.use(express.json({ limit: '50mb' }));

// Routes
app.use('/registrarse', registerRoute);
app.use('/handwriting', handwritingRoute);

// Start the server
app.listen(port, () => {
    console.log(`Server running at http://${domain}:${port}/`);
});