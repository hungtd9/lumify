
define([
    'flight/lib/component',
    'util/video/scrubber',
    './image/image',
    '../withTypeContent',
    '../withHighlighting',
    'detail/dropdowns/termForm/termForm',
    'detail/properties',
    'tpl!./artifact',
    'tpl!./transcriptEntry',
    'tpl!util/alert',
    'util/range',
    'service/ontology',
    'service/vertex',
    'data'
], function(
    defineComponent,
    VideoScrubber,
    Image,
    withTypeContent, withHighlighting,
    TermForm,
    Properties,
    template,
    transcriptEntryTemplate,
    alertTemplate,
    rangeUtils,
    OntologyService,
    VertexService,
    appData) {
    'use strict';

    return defineComponent(Artifact, withTypeContent, withHighlighting);

    function Artifact() {

        this.ontologyService = new OntologyService();
        this.vertexService = new VertexService();

        this.defaultAttrs({
            previewSelector: '.preview',
            currentTranscriptSelector: '.currentTranscript',
            imagePreviewSelector: '.image-preview',
            detectedObjectSelector: '.detected-object',
            artifactSelector: '.artifact-image',
            propertiesSelector: '.properties',
            titleSelector: '.artifact-title',
            textSelector: '.text'
        });

        this.after('initialize', function() {
            var self = this;

            this.on('click', {
                detectedObjectSelector: this.onDetectedObjectClicked
            });
            this.on('copy cut', {
                textSelector: this.onCopyText
            });
            this.on('scrubberFrameChange', this.onScrubberFrameChange);
            this.on('videoTimeUpdate', this.onVideoTimeUpdate);
            this.on('DetectedObjectCoordsChange', this.onCoordsChanged);
            this.on('termCreated', this.onTeardownDropdowns);
            this.on(document, 'verticesUpdated', this.onVerticesUpdated);
            this.after('tearDownDropdowns', this.onTeardownDropdowns);

            this.$node.on('mouseenter mouseleave', '.detected-object-tag', this.onDetectedObjectHover.bind(this));

            this.loadArtifact();
        });

        this.before('teardown', function() {
            this.select('propertiesSelector').teardownComponent(Properties);
        });

        this.onCopyText = function(event) {
            var selection = getSelection(),
                target = event.target;

            if (!selection.isCollapsed && selection.rangeCount === 1) {

                var $anchor = $(selection.anchorNode),
                    $focus = $(selection.focusNode),
                    offsets = [];
                
                [
                    {el:$anchor, offset:selection.anchorOffset}, 
                    {el:$focus, offset:selection.focusOffset}
                ].forEach(function(node) {
                    var offset = 
                        (node.el.parent('.entity').data('info') || {}).start || 
                        (node.el.prev('.entity').data('info') || {}).end || 
                        0;

                    offsets.push(offset + node.offset);
                });

                offsets = _.sortBy(offsets, function(a, b) { return a - b });

                var range = selection.getRangeAt(0),
                    output = {},
                    contextRange = rangeUtils.expandRangeByWords(range, 4, output),
                    context = contextRange.toString(),
                    contextHighlight =
                        '...' +
                        output.before + 
                        '<span class="selection">' + selection.toString() + '</span>' +
                        output.after + 
                        '...';

                this.trigger('copydocumenttext', {
                    startOffset: offsets[0],
                    endOffset: offsets[1],
                    snippet: contextHighlight,
                    vertexId: this.attr.data.id,
                    text: selection.toString(),
                    vertexTitle: this.attr.data.properties.title.value
                });
            }
        };

        this.onVerticesUpdated = function(event, data) {
            var matching = _.findWhere(data.vertices, { id: this.attr.data.id });

            if (matching) {
                this.select('titleSelector').html( matching.properties.title.value );
            }
        };

        this.loadArtifact = function() {
            var self = this,
                vertex = self.attr.data;

            this.handleCancelling(appData.refresh(vertex))
                .done(this.handleVertexLoaded.bind(this));
        };

        this.handleVertexLoaded = function(vertex) {
            var self = this;
            this.videoTranscript = vertex.videoTranscript;
            this.videoDuration = vertex.videoDuration;
            if (vertex.detectedObjects && vertex.detectedObjects.length > 0) {
                vertex.detectedObjects = vertex.detectedObjects.sort(function(a, b){
                    var aX = a.x1, bX = b.x1;
                    return aX - bX;
                });
            }

            this.$node.html(template({
                vertex: vertex,
                fullscreenButton: this.fullscreenButton([vertex.id]),
                auditsButton: this.auditsButton()
            }));

            Properties.attachTo(this.select('propertiesSelector'), { data: vertex });

            this.vertexService.getArtifactHighlightedTextById(vertex.id)
                .done(function(artifactText, status, xhr) {
                    var displayType = vertex.concept.displayType;
                    if (xhr.status === 204 && displayType != 'image' && displayType != 'video') {
                        self.select('textSelector').html(alertTemplate({ error: 'No Text Available' }));
                    } else {
                        self.select('textSelector').html(!artifactText ? '' : artifactText.replace(/[\n]+/g, "<br><br>\n"));
                    }
                    self.updateEntityAndArtifactDraggables();
                    if (self[displayType + 'Setup']) {
                        self[displayType + 'Setup'](vertex);
                    }
            });
        };

        this.onVideoTimeUpdate = function(evt, data) {
            var time = data.currentTime * 1000;
            this.updateCurrentTranscript(time);
        };

        this.onScrubberFrameChange = function(evt, data) {
            var frameIndex = data.index;
            var numberOfFrames = data.numberOfFrames;
            var time = (this.videoDuration / numberOfFrames) * frameIndex;
            this.updateCurrentTranscript(time);
        };

        this.updateCurrentTranscript = function(time) {
            var transcriptEntry = this.findTranscriptEntryForTime(time);
            var html = '';
            if(transcriptEntry) {
                html = transcriptEntryTemplate({
                    transcriptEntry: transcriptEntry,
                    formatTimeOffset: this.formatTimeOffset
                });
            }
            this.select('currentTranscriptSelector').html(html);
        };

        this.findTranscriptEntryForTime = function(time) {
            if(!this.videoTranscript || !this.videoTranscript.entries) {
                return null;
            }
            var bestMatch = this.videoTranscript.entries[0];
            for(var i = 0; i < this.videoTranscript.entries.length; i++) {
                if(this.videoTranscript.entries[i].start <= time) {
                    bestMatch = this.videoTranscript.entries[i];
                }
            }
            return bestMatch;
        };

        this.formatTimeOffset = function(time) {
            return sf('{0:h:mm:ss}', new sf.TimeSpan(time));
        };

        this.onDetectedObjectClicked = function(event) {
            event.preventDefault();
            var self = this,
                $target = $(event.target),
                info = $target.closest('.label-info').data('info');

            $target.closest('.label-info').parent().addClass('focused');
            info.existing = true
            if (info.entityVertex) {
                var result = $.extend(info,info.entityVertex);
                delete result.entityVertex;
                info = result;
            }
            this.trigger('DetectedObjectEdit', info);
            this.showForm(info, this.attr.data, $target);
        };

        this.onCoordsChanged = function(event, data) {
            var self = this,
                vertex = appData.vertex(this.attr.data.id);
            var detectedObject,
                width = parseFloat(data.x2)-parseFloat(data.x1),
                height = parseFloat(data.y2)-parseFloat(data.y1);
            if (vertex.detectedObjects) {
                detectedObject = $.extend(true, {}, _.find(vertex.detectedObjects, function(obj) {
                    return (obj && (obj.graphVertexId || obj._rowKey)) === data.id;
                }));
            }

            if (width < 5 || height < 5) {
                return TermForm.teardownAll();
            }

            detectedObject = detectedObject || {};
            detectedObject.x1 = data.x1;
            detectedObject.y1 = data.y1;
            detectedObject.x2 = data.x2;
            detectedObject.y2 = data.y2;
            this.showForm(detectedObject, this.attr.data, this.$node);
        };

        this.onTeardownDropdowns = function() {
            this.trigger('DetectedObjectDoneEditing');
        };

        this.onDetectedObjectHover = function(event) {
            var $target = $(event.target),
                tag = $target.closest('.detected-object-tag'),
                badge = tag.find('.label-info'),
                info = badge.data('info');

            if (info.entityVertex) {
                var result = $.extend(info,info.entityVertex);
                delete info.entityVertex;
                info = result;
            }

            this.trigger(
                event.type === 'mouseenter' ? 'DetectedObjectEnter' : 'DetectedObjectLeave',
                info
            );
        };

        this.videoSetup = function(vertex) {
            VideoScrubber.attachTo(this.select('previewSelector'), {
                rawUrl: vertex.imageRawSrc,
                posterFrameUrl: vertex.imageSrc,
                videoPreviewImageUrl: vertex.imageFramesSrc,
                allowPlayback: true
            });
        };

        this.imageSetup = function(vertex) {
            var self = this;
            var data = {
                src: vertex.imageRawSrc,
                id: vertex.id
            };
            Image.attachTo(this.select('imagePreviewSelector'), { data: data });
            this.before('teardown', function (){
                self.select('imagePreviewSelector').teardownComponent(Image);
            });
        };

        this.showForm = function (dataInfo, artifactInfo, $target){
            if ($('.detected-object-labels .underneath').length === 0) {
                TermForm.teardownAll ();
            }

            var root = $('<div class="underneath">').insertAfter($target.closest('.type-content').find('.detected-object-labels'));
            var resolvedVertex =  { id: dataInfo.id, properties: dataInfo.properties } ;

            TermForm.attachTo (root, {
                artifactData: artifactInfo,
                dataInfo: dataInfo,
                resolvedVertex: resolvedVertex,
                existing: dataInfo.existing || resolvedVertex.id ? true : false,
                detectedObject: true
            });
        };
     }
});