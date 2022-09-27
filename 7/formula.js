function suma(){
    
    var farenheit = parseFloat(document.getElementById('farenheit').value);
    var CELCIUS =  ((farenheit - 32) *5 ) / 9;

    document.getElementById('CELCIUS').value = CELCIUS;
}