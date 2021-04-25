// @flow

var analyzers = {}, analyzerData = {};
var currentAnalyzerRequest;

/* exported analyzerData, analyzers, getAnalyzers, populateAnalyzerList, populateSecondaryAnalyzerList */

/* global config, modeEnabled, persistChoices, restoreChoices, localizeInterface, readCache, ajaxSend, ajaxComplete,
    cache, getLangByCode, filterLangPairList, allowedLang, sendEvent, callApy, apyRequestTimeout, removeSoftHyphens */
/* global ENTER_KEY_CODE */

if(modeEnabled('analysis')) {
    $(document).ready(function () {
        $('#analysisForm').submit(function () {
            analyze();
            persistChoices('analyzer', true);
        });

        $('#primaryAnalyzerMode').change(function () {
            populateSecondaryAnalyzerList();
            localizeInterface();
            persistChoices('analyzer');
        });

        $('#secondaryAnalyzerMode').change(function () {
            persistChoices('analyzer');
        });

        $('#morphAnalyzerInput').keydown(function (e /*: JQueryKeyEventObject */) {
            if(e.keyCode === ENTER_KEY_CODE && !e.shiftKey) {
                e.preventDefault();
                analyze();
            }
        });

        $('#morphAnalyzerInput').on('input propertychange', function () {
            persistChoices('analyzer');
        });

        $('#morphAnalyzerInput').blur(function () {
            persistChoices('analyzer', true);
        });
    });
}

function getAnalyzers() /*: JQueryPromise<any> */ {
    var deferred = $.Deferred();

    if(config.ANALYZERS) {
        analyzerData = config.ANALYZERS;
        populateAnalyzerList(analyzerData);
        deferred.resolve();
    }
    else {
        var analyzers = readCache('analyzers', 'LIST_REQUEST');
        if(analyzers) {
            analyzerData = analyzers;
            populateAnalyzerList(analyzers);
            deferred.resolve();
        }
        else {
            console.warn('Analyzers cache ' + (analyzers ? 'miss' : 'stale') + ', retrieving from server');
            $.jsonp({
                url: config.APY_URL + '/list?q=analyzers',
                beforeSend: ajaxSend,
                success: function (data, _textStatus, _xOptions) {
                    analyzerData = data;
                    populateAnalyzerList(analyzerData);
                    cache('analyzers', data);
                },
                error: function () {
                    console.error('Failed to get available analyzers');
                },
                complete: function () {
                    ajaxComplete();
                    deferred.resolve();
                },
            });
        }
    }

    return deferred.promise();
}

function populateAnalyzerList(data /*: {} */) {
    $('.analyzerMode').empty();

    analyzers = ({} /*: {[string]: string[] } */);
    for(var lang in data) {
        var analyzerLang = lang.indexOf('-') !== -1 ? lang.split('-')[0] : lang;
        var group = analyzers[analyzerLang];
        if(group) {
            group.push(lang);
        }
        else {
            analyzers[analyzerLang] = [lang];
        }
    }

    var analyzersArray /*: [string, string][] */ = [];
    $.each(analyzers, function (analyzerLang /*: string */, lang /*: string */) {
        analyzersArray.push([analyzerLang, lang]);
    });
    analyzersArray = filterLangPairList(analyzersArray, function (analyzer) {
        return allowedLang(analyzer[0]);
    });
    analyzersArray.sort(function (a, b) {
        return getLangByCode(a[0]).localeCompare(getLangByCode(b[0]));
    });

    for(var i = 0; i < analyzersArray.length; i++) {
        lang = analyzersArray[i][0];
        $('#primaryAnalyzerMode').append($('<option></option').val(lang).text(getLangByCode(lang)));
    }

    restoreChoices('analyzer');
}

function populateSecondaryAnalyzerList() {
    var group /*: string[] */ = analyzers[$('#primaryAnalyzerMode').val()];
    $('#secondaryAnalyzerMode').empty();

    if(group) {
        if(group.length <= 1) {
            $('#secondaryAnalyzerMode').fadeOut('fast');
        }
        else {
            $('#secondaryAnalyzerMode').fadeIn('fast');
        }

        group.sort(function (a, b) {
            return a.length - b.length;
        });

        for(var i = 0; i < group.length; i++) {
            var lang = group[i];
            var langDisplay = lang.indexOf('-') !== -1
                ? getLangByCode(lang.split('-')[0]) + '-' + getLangByCode(lang.split('-')[1])
                : getLangByCode(lang);
            $('#secondaryAnalyzerMode').append($('<option></option').val(lang).text(langDisplay));
        }
    }
    else {
        $('#secondaryAnalyzerMode').fadeOut('fast');
    }
}

function analyze() {
    var input /*: string */ = removeSoftHyphens($('#morphAnalyzerInput').val());

    if(!$('#primaryAnalyzerMode').val() || input.trim() === '') {
        return;
    }

    var analyzerMode /*: string */ = analyzers[$('#primaryAnalyzerMode').val()].length > 1
        ? $('#secondaryAnalyzerMode').val()
        : analyzers[$('#primaryAnalyzerMode').val()][0];
    sendEvent('analyzer', 'analyze', analyzerMode, $('#morphAnalyzerInput').val().length);

    $('#morphAnalyzerOutput').addClass('blurred');

    if(currentAnalyzerRequest) {
        currentAnalyzerRequest.abort();
        clearTimeout(apyRequestTimeout);
    }

    currentAnalyzerRequest = callApy({
        data: {
            'lang': analyzerMode,
            'q': input,
        },
        success: handleAnalyzeSuccessResponse,
        error: handleAnalyzeErrorResponse,
        complete: function () {
            ajaxComplete();
            currentAnalyzerRequest = null;
        },
    }, '/analyze');
}

function handleAnalyzeSuccessResponse(data /*: string[][] */) {
    var regex = /([^<]*)((<[^>]+>)*)/g;
    $('#morphAnalyzerOutput').html('<tbody></tbody>');
    for(var i = 0; i < data.length; i++) {
        var leftTD = $('<td class="text-right"></td>');
        var strong = $('<strong></strong>').text(data[i][1].trim());
        var arrow = $('<span></span>').html('&nbsp;&nbsp;&#8620;');
        leftTD.append(strong).append(arrow);

        var rightTD = $('<td class="text-left"></td>');
        var splitUnit = data[i][0].split('/');

        if(splitUnit[1][0] === '*') {
            rightTD.addClass('text-danger');
        }

        var tr = $('<tr></tr>').append(leftTD).append(rightTD);
        $('#morphAnalyzerOutput tbody').append(tr);

        var joinedMorphemes = {};
        for(var j = 1; j < splitUnit.length; j++) {
            var unit = splitUnit[j];
            var matches = unit.match(regex);

            if(matches && matches.length > 2) {
                for(var k = 1; k < matches.length - 1; k++) {
                    if(joinedMorphemes[matches[k]]) {
                        joinedMorphemes[matches[k]].push(unit);
                    }
                    else {
                        joinedMorphemes[matches[k]] = [unit];
                    }
                }
            }
            else {
                var unitDiv = $('<div></div>').html(formatUnit(unit));
                rightTD.append(unitDiv);
            }
        }
        $.each(joinedMorphemes, function (joinedMorpheme, units) {
            var morphemeDiv = $('<div></div>').html(formatUnit(joinedMorpheme));
            rightTD.append(morphemeDiv);
            for(var j = 0; j < units.length; j++) {
                var unitDiv = $('<div class="unit"></div>').html(formatUnit(units[j].match(regex)[0]));
                rightTD.append(unitDiv);
            }
        });
        $('#morphAnalyzerOutput').removeClass('blurred');
    }
}

function formatUnit(unit /*: string */) {
    var tagRegex = /<([^>]+)>/g, arrow = '&nbsp;&nbsp;&#8612;&nbsp;&nbsp;', tags /*: string[] */ = [];
    var tagMatch /*: ?string[] */ = tagRegex.exec(unit);
    while(tagMatch) {
        tags.push(tagMatch[1]);
        tagMatch = tagRegex.exec(unit);
    }
    var tagStartLoc = unit.indexOf('<');
    return unit.substring(0, tagStartLoc !== -1 ? tagStartLoc : unit.length) +
        (tags.length > 0 ? arrow + tags.join(' &#8901; ') : '');
}

function handleAnalyzeErrorResponse(xOptions, error /*: string */) {
    $('#morphAnalyzerOutput').text(error).removeClass('blurred');
}

/*:: export {analyzerData, analyzers, getAnalyzers, populateAnalyzerList, populateSecondaryAnalyzerList} */

/*:: import {ajaxComplete, ajaxSend, allowedLang, apyRequestTimeout, callApy, filterLangPairList,
    modeEnabled, sendEvent, removeSoftHyphens} from "./util.js" */
/*:: import {ENTER_KEY_CODE} from "./util.js" */
/*:: import {getLangByCode, localizeInterface} from "./localization.js" */
/*:: import {cache, persistChoices, readCache, restoreChoices} from "./persistence.js" */
