var map = [[]];
var bombsLeft = 0;
var revealed = 0;

function generateGrid(width, height){
    var table = '<table>';
    for (var i = 0; i < height; i++){
        table += "<tr>";
        map[i] = [];
        for (var j = 0; j < width; j++){
            table+='<td id="'+j+i+'" onclick="reveal('+i+','+j+','+width+','+height+')" oncontextmenu="mark('+i+','+j+'); return false">x</td>';
            map[i][j]=j+','+i;
        }
        table += '</tr>';
    }
    $("#grid").html(table);
}

function mark(colIndex, rowIndex){            
    if ($("#"+rowIndex+colIndex).hasClass('suspectedBomb')){
        $("#"+rowIndex+colIndex).removeClass('suspectedBomb');
        $("#"+rowIndex+colIndex).html('x');            
    } else {
        $("#"+rowIndex+colIndex).addClass('suspectedBomb');
        $("#"+rowIndex+colIndex).html('');
        bombsLeft--;            
        $("#bombsLeft").html('Bombs left: '+bombsLeft);
    }
}

function placeBombs(quantity, width, height){
    bombsLeft = quantity;
    for (var i = 0 ; i < quantity; i++){
        var rowIndex = Math.floor(Math.random()*width);
        var colIndex = Math.floor(Math.random()*height);
        map[colIndex][rowIndex] = 'B';
    }
    for (var rowIndex = 0; rowIndex < width; rowIndex++){
        for (var colIndex = 0; colIndex < height; colIndex++){
            if (map[colIndex][rowIndex]=='B'){
                // don't do anything
            } else {
                // calculate the number of neighbors with a bomb
                var bombCount = 0;
                for (var i = -1; i < 2; i++){
                    for (var j = -1; j < 2; j++){
                        var neighborRowIndex = rowIndex + i;
                        var neighborColIndex = colIndex + j;
                        if (neighborColIndex>=0 && neighborRowIndex>=0 && neighborColIndex<height && neighborRowIndex<width){
                            if (map[neighborColIndex][neighborRowIndex]=='B'){
                                bombCount++;
                            }
                        }
                    }
                }
                map[colIndex][rowIndex]=bombCount;
            }
        }
    }
}

function reveal(colIndex, rowIndex, height, width){
    if (map[colIndex][rowIndex]=='0' || map[colIndex][rowIndex]=='REVEALED'){
        revealNeighbor(colIndex,rowIndex,height,width);
    }
    else if (map[colIndex][rowIndex]=='B'){
        $("#"+rowIndex+colIndex).addClass('bomb');
        $("#"+rowIndex+colIndex).html('');
    } else {
        $("#"+rowIndex+colIndex).html(map[colIndex][rowIndex]);
        $("#"+rowIndex+colIndex).addClass('b'+map[colIndex][rowIndex]);
        revealed++;
    }
    if (height*width==revealed){
        $('#message').html('All done');
    } else {
        $('#message').html(height*width-revealed+' left...');
    }
}

function revealNeighbor(colIndex,rowIndex, height, width){
    if (map[colIndex][rowIndex]=='0'){
        if (map[colIndex][rowIndex]!='REVEALED'){
            $("#"+rowIndex+colIndex).html(map[colIndex][rowIndex]);
            $("#"+rowIndex+colIndex).addClass('zero');
            revealed++;
        }
        map[colIndex][rowIndex]='REVEALED';
        for (var i = -1; i < 2; i++){
            for (var j = -1; j < 2; j++){
                var newColIndex = colIndex + i;
                var newRowIndex = rowIndex + j;
                if (newColIndex >= 0 && newColIndex < height && newRowIndex >= 0 && newRowIndex < width){
                    revealNeighbor(newColIndex,newRowIndex, height, width);
                }
            }
        }
    } else if (map[colIndex][rowIndex]!='B' && map[colIndex][rowIndex]!='REVEALED'){
        $("#"+rowIndex+colIndex).html(map[colIndex][rowIndex]);
        $("#"+rowIndex+colIndex).addClass('b'+map[colIndex][rowIndex]);
    }
}



function generateGame(columns, rows, bombCount){
    generateGrid(columns, rows);
    placeBombs(bombCount, columns, rows);
}

function generateNewGame(){
    generateGame($("#cols").val(),$("#rows").val(),$("#bombs").val());
    $("#message").html('Generating a '+$("#rows").val()+' x '+$("#cols").val()+'grid with '+$("#bombs").val()+' bombs.');
}

// playtest-crew SDK integration: the one required call (sdk/README.md step 2).
// map/bombsLeft/revealed are top-level vars, so this closure always reads
// whatever they currently hold -- one call here is enough, no need to call
// exposeState again after every move.
window.PTC.exposeState(function () {
    return { map: map, bombsLeft: bombsLeft, revealed: revealed };
});