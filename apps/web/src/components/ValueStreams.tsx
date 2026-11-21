import { primaryText, valueStreamViews, type Model } from '@openarch/core';

interface ValueStreamsProps {
  model: Model;
  onSelect: (id: string) => void;
}

/** Value-stream view: stages in flow order with the capabilities supporting each. */
export default function ValueStreams({ model, onSelect }: ValueStreamsProps) {
  const streams = valueStreamViews(model);
  if (streams.length === 0) {
    return (
      <div className="panel-card empty">
        No value streams yet — add Value Stream and Capability elements, chain stages with Flow and link
        capabilities with Realization.
      </div>
    );
  }
  return (
    <div className="dashboard-grid">
      {streams.map((stream) => (
        <section className="panel-card wide" key={stream.stream.id}>
          <h3>
            <button className="link-button" onClick={() => onSelect(stream.stream.id)}>
              {primaryText(stream.stream.name) || stream.stream.id}
            </button>
          </h3>
          <ol className="value-stream">
            {stream.stages.map((stage) => (
              <li key={stage.element.id} className="value-stream-stage">
                <button className="link-button" onClick={() => onSelect(stage.element.id)}>
                  {primaryText(stage.element.name) || stage.element.id}
                </button>
                <span className="muted">{stage.element.type}</span>
                {stage.capabilities.length > 0 && (
                  <span className="chip-row">
                    {stage.capabilities.map((capability) => (
                      <button key={capability.id} className="chip" onClick={() => onSelect(capability.id)}>
                        {primaryText(capability.name) || capability.id}
                      </button>
                    ))}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
