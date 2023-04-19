// Init a simple server with ejs config
const express = require('express');
const app = express();
const {port, domain} = require('./config');
const registerRoute = require('./routes/register');

// Set the view engine to ejs
app.set('view engine', 'ejs');
app.set('views', './views');

// Static files
app.use(express.static('public'));

// Routes
app.use('/registrarse', registerRoute);

// Start the server
app.listen(port, () => {
    console.log(`Server running at http://${domain}:${port}/`);
});