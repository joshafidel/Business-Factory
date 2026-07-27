import { describe, expect, it } from "vitest";
import { mapSimplyRetsListing } from "../listing-factory/feeds";

const RECORD = {
  mlsId: 1005192,
  listingId: "49699701",
  listPrice: 459000,
  remarks: "Renovated kitchen with quartz counters. Fenced backyard.",
  address: {
    full: "74434 East Sweet Bottom Br #18393",
    city: "Houston",
    state: "Texas",
    postalCode: "77096",
  },
  property: { bedrooms: 3, bathsFull: 2, bathsHalf: 1, area: 1850 },
  agent: {
    firstName: "Shoshana",
    lastName: "Phelps",
    contact: { cell: "(825) 907-4024", email: "agent@example.com", office: "(582) 242-9591" },
  },
  office: { name: "Acme Realty" },
  mls: { status: "Active" },
  photos: [
    "https://cdn.example.com/home9.jpg",
    "https://cdn.example.com/home-inside-9.jpg",
    12345, // junk entry — must be dropped
  ],
};

describe("mapSimplyRetsListing", () => {
  it("maps a SimplyRETS record into the feed shape", () => {
    const listing = mapSimplyRetsListing(RECORD);
    expect(listing.mlsId).toBe("1005192");
    expect(listing.listingId).toBe("49699701");
    expect(listing.address).toBe("74434 East Sweet Bottom Br #18393");
    expect(listing.city).toBe("Houston");
    expect(listing.price).toBe("$459,000");
    expect(listing.beds).toBe("3");
    expect(listing.baths).toBe("2.5");
    expect(listing.sqft).toBe("1,850");
    expect(listing.agentName).toBe("Shoshana Phelps");
    expect(listing.agentPhone).toBe("(825) 907-4024");
    expect(listing.brokerage).toBe("Acme Realty");
    expect(listing.photos).toEqual([
      "https://cdn.example.com/home9.jpg",
      "https://cdn.example.com/home-inside-9.jpg",
    ]);
    expect(listing.status).toBe("Active");
  });

  it("handles sparse records without crashing", () => {
    const listing = mapSimplyRetsListing({ mlsId: "x" });
    expect(listing.mlsId).toBe("x");
    expect(listing.price).toBe("");
    expect(listing.photos).toEqual([]);
    expect(listing.agentName).toBe("");
  });
});
