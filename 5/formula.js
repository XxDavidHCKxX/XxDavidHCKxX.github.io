function suma(){
    var altura = parseFloat(document.getElementById('altura').value);
    var base = parseFloat(document.getElementById('base').value);
    var resultado = (base + altura) / 2;

    document.getElementById('resultado').value = resultado;
    
    }