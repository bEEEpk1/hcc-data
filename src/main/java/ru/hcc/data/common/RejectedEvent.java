package ru.hcc.data.common;

/** Invalid/untrusted external event. Never include raw payload in the message. */
public class RejectedEvent extends RuntimeException {
    private final String code;
    public RejectedEvent(String code) {
        super(code);
        this.code = code;
    }
    public String code() { return code; }
}
